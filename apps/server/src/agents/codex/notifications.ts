import { realpathSync } from 'node:fs';
import type { Ask, ClaudeStatus } from '../types.js';
import type { CodexHost } from './agent.js';
import { askOf, entriesOf, isApproval, turnNote, usageOf, type Entry } from './items.js';
import type { Notification, RequestId, ServerRequest } from './rpc.js';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

type HeldAsk = { requestId: RequestId; method: string; params: Obj; ask: Ask };

export type Thread = {
  session: string;
  threadId: string;
  joined: boolean;
  joining: Promise<void> | null;
  // As the app server last said: idle, working, or waiting on the person.
  status: ClaudeStatus;
  compacting: boolean;
  asks: Map<string, HeldAsk>;
  // File changes as they started, which their approvals do not name the files of.
  files: Map<string, Obj>;
  live: Map<string, string>;
  liveTimer: NodeJS.Timeout | null;
  said: string;
  tokenUsage?: unknown;
  model?: string;
  effort?: string;
};

// What the notifications ask of the agent: to follow a thread found for a session, and to join one.
export type ThreadKeeper = {
  track(session: string, threadId: string): Thread;
  join(t: Thread): Promise<void>;
  following(session: string): boolean;
};

// How often the reply being written is put in the journal while deltas come.
const LIVE_MS = 200;

const realDir = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

// What the app server tells of the threads the agent follows, and what it asks: turned into each session's
// status, chat, asks and usage.
export class CodexNotifications {
  private rateLimits: unknown = null;

  constructor(
    private readonly host: CodexHost,
    private readonly threads: Map<string, Thread>,
    private readonly agent: ThreadKeeper,
  ) {}

  notified({ method, params }: Notification): void {
    if (method === 'account/rateLimits/updated') {
      this.rateLimits = params.rateLimits;
      for (const t of this.threads.values()) this.usage(t);
      return;
    }
    if (method === 'thread/started') return this.started(obj(params.thread));
    const t = this.threads.get(str(params.threadId));
    if (!t) return;
    switch (method) {
      case 'thread/status/changed':
        this.statusIs(t, obj(params.status));
        if (!t.joined) void this.agent.join(t);
        return;
      case 'thread/closed':
        t.joined = false;
        return;
      case 'thread/name/updated':
        this.nameIs(t, params.threadName);
        return;
      case 'turn/completed': {
        const note = turnNote(params.turn);
        if (note) this.put(t, [note]);
        if (t.asks.size) {
          t.asks.clear();
          this.host.asksChanged(t.session);
        }
        return;
      }
      case 'item/started': {
        const item = obj(params.item);
        if (item?.type === 'fileChange') t.files.set(str(item.id), item);
        if (item?.type === 'contextCompaction') this.compacting(t, true);
        return;
      }
      case 'item/completed': {
        const item = obj(params.item);
        const at = typeof params.completedAtMs === 'number' ? new Date(params.completedAtMs).toISOString() : undefined;
        this.put(t, entriesOf(item, at));
        if (item?.type === 'agentMessage') {
          t.said = str(item.text) || t.said;
          this.liveDone(t, str(item.id));
        }
        if (item?.type === 'fileChange') t.files.delete(str(item.id));
        if (item?.type === 'contextCompaction') this.compacting(t, false);
        return;
      }
      case 'item/agentMessage/delta':
        t.live.set(str(params.itemId), (t.live.get(str(params.itemId)) ?? '') + str(params.delta));
        t.liveTimer ??= setTimeout(() => this.liveNow(t), LIVE_MS);
        return;
      case 'thread/tokenUsage/updated':
        t.tokenUsage = params.tokenUsage;
        this.usage(t);
        return;
      case 'thread/settings/updated': {
        const s = obj(params.threadSettings);
        t.model = str(s?.model) || t.model;
        t.effort = str(s?.effort) || t.effort;
        this.usage(t);
        return;
      }
      case 'serverRequest/resolved': {
        const gone = [...t.asks.entries()].find(([, a]) => a.requestId === params.requestId);
        if (!gone) return;
        t.asks.delete(gone[0]);
        this.host.asksChanged(t.session);
        return;
      }
    }
  }

  // An approval is held for the phone; the TUI has it too and either may answer. Anything else Codex asks is
  // left to the TUI.
  requested({ id, method, params }: ServerRequest): void {
    const t = this.threads.get(str(params.threadId));
    if (!t || !isApproval(method)) return;
    const askId = `codex-${String(id)}`;
    const ask = askOf(askId, method, params, t.files.get(str(params.itemId)));
    t.asks.set(askId, { requestId: id, method, params, ask });
    this.host.asksChanged(t.session);
    if (t.status === 'waiting') this.host.moved(t.session, 'waiting', ask.title);
  }

  started(thread: Obj | undefined): void {
    const threadId = str(thread?.id);
    if (!thread || !threadId || thread.ephemeral === true || thread.parentThreadId || this.threads.has(threadId)) return;
    const sessions = this.host.sessions();
    if (sessions.some((s) => s.threadId === threadId)) return;
    // Only the sessions' TUIs run on this app server: a thread started in a folder is the oldest session there
    // with none yet. Its TUI may have asked something first (trust this folder?) for any time.
    const cwd = realDir(str(thread.cwd));
    const [owner] = sessions
      .filter((s) => !s.threadId && !this.agent.following(s.id) && realDir(s.cwd) === cwd)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (!owner) return;
    this.host.setThread(owner.id, threadId);
    const t = this.agent.track(owner.id, threadId);
    // Joined only once its first turn writes it; what it runs on is known now.
    this.ranOn(t, thread);
    this.host.moved(owner.id, t.status, '');
  }

  nameIs(t: Thread, name: unknown): void {
    if (typeof name === 'string' && name.trim()) this.host.named(t.session, name);
  }

  statusIs(t: Thread, status: Obj | undefined): void {
    const type = str(status?.type);
    const flags = Array.isArray(status?.activeFlags) ? status.activeFlags : [];
    if (type === 'active') t.status = flags.length ? 'waiting' : 'working';
    else if (type === 'idle' || type === 'systemError') t.status = 'idle';
    else return;
    this.show(t);
  }

  private compacting(t: Thread, on: boolean): void {
    t.compacting = on;
    this.show(t);
  }

  private show(t: Thread): void {
    const status: ClaudeStatus = t.compacting ? 'compacting' : t.status;
    const said = status === 'waiting' ? ([...t.asks.values()].at(-1)?.ask.title ?? '') : t.said;
    this.host.moved(t.session, status, said);
  }

  // The model and effort a thread runs on, as the thread itself says.
  ranOn(t: Thread, thread: Obj | undefined): void {
    t.model = str(thread?.model) || t.model;
    t.effort = str(thread?.reasoningEffort) || t.effort;
    this.usage(t);
  }

  usage(t: Thread): void {
    this.host.setUsage(t.session, usageOf({ tokenUsage: t.tokenUsage, rateLimits: this.rateLimits, model: t.model, effort: t.effort }));
  }

  private put(t: Thread, entries: Entry[]): void {
    if (entries.length) this.host.journal.putAgentItems(t.session, t.threadId, entries);
  }

  private liveNow(t: Thread): void {
    t.liveTimer = null;
    if (this.threads.get(t.threadId) !== t) return;
    this.host.journal.live(t.session, [...t.live.values()].at(-1) || null);
  }

  private liveDone(t: Thread, itemId: string): void {
    t.live.delete(itemId);
    if (t.liveTimer) clearTimeout(t.liveTimer);
    t.liveTimer = null;
    this.host.journal.live(t.session, [...t.live.values()].at(-1) || null);
  }
}
