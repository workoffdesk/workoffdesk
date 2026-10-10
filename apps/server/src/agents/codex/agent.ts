import type { ChatItem } from '../claude/transcript/chat.js';
import type { Usage } from '../claude/usage.js';
import type { Answer, Ask, ClaudeStatus } from '../types.js';
import { connectAppServer, type AppServerOptions } from './appServer.js';
import { decisionOf, entriesOf, inputOf, type Entry } from './items.js';
import { CodexNotifications, type Thread } from './notifications.js';
import { CodexRpc, RpcError } from './rpc.js';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// What the agent needs of the machine it serves: the sessions it runs and where what it learns goes.
// What the agent writes to the session's journal: the thread's items, and the reply being written.
export type CodexJournal = {
  putAgentItems(id: string, conv: string, entries: { id: string; item: ChatItem; clientId?: string }[]): void;
  live(id: string, text: string | null): void;
};

export type CodexHost = {
  journal: CodexJournal;
  // The Codex sessions known, with the thread each holds once known.
  sessions(): { id: string; cwd: string; createdAt: number; threadId?: string }[];
  setThread(id: string, threadId: string): void;
  // said: what the change was about in Codex's words (its last reply, what it asks).
  moved(id: string, status: ClaudeStatus, said: string): void;
  // What Codex calls a session's thread, named by it or by the person.
  named(id: string, name: string): void;
  setUsage(id: string, usage: Usage | null): void;
  asksChanged(id: string): void;
  log(msg: string, o: object): void;
};

const ITEMS_PAGE = 200;
const LIST_MS = 30_000;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;

// A thread not written to disk yet (no turn so far) cannot be joined; its first turn writes it.
const notWrittenYet = (e: unknown) => e instanceof RpcError && /no rollout/i.test(e.message);

// WorkOffDesk's sessions of Codex, as one client of the app server their TUIs run on (docs/design/
// 2026-10-07-codex-sessions.md): it learns each session's thread, joins it, and turns what the thread does
// into the session's status, chat, asks and usage; what the phone sends goes to the thread.
export class CodexAgent {
  private rpc: CodexRpc | null = null;
  private connecting: Promise<CodexRpc> | null = null;
  private retryMs = RETRY_MIN_MS;
  private retryAt = 0;
  private closed = false;
  private readonly threads = new Map<string, Thread>();
  private readonly bySession = new Map<string, string>();
  // What the app server tells of the threads followed, and asks of them.
  private readonly notes: CodexNotifications;

  constructor(
    readonly options: AppServerOptions,
    private readonly host: CodexHost,
  ) {
    this.notes = new CodexNotifications(host, this.threads, {
      track: (session, threadId) => this.track(session, threadId),
      join: (t) => this.join(t),
      following: (session) => this.bySession.has(session),
    });
  }

  // Before a new session's TUI starts: the app server is running, and the thread it resumes is the
  // session's. One it starts is found when it does (started).
  async start(session: string, resume?: string): Promise<void> {
    await this.link();
    if (!resume) return;
    this.host.setThread(session, resume);
    this.track(session, resume);
  }

  // A session whose thread is known is followed; called on every listing, so a restart picks it up again.
  follow(session: string, threadId: string | undefined): void {
    if (threadId && !this.bySession.has(session)) this.track(session, threadId);
    if (!this.rpc?.open && Date.now() >= this.retryAt) void this.link().catch(() => {});
  }

  forget(session: string): void {
    const threadId = this.bySession.get(session);
    this.bySession.delete(session);
    if (!threadId) return;
    const t = this.threads.get(threadId);
    if (t?.liveTimer) clearTimeout(t.liveTimer);
    this.threads.delete(threadId);
    void this.rpc?.request('thread/unsubscribe', { threadId }).catch(() => {});
  }

  // The threads people had on this Mac, newest first, as the app server lists them: it reads every session file
  // to answer, which takes seconds.
  async listThreads(params: object): Promise<unknown[]> {
    const { data } = await (await this.link()).request<{ data?: unknown }>('thread/list', params, LIST_MS);
    return Array.isArray(data) ? data : [];
  }

  // One thread's metadata, read without loading it; undefined when there is no such thread.
  async readThread(threadId: string): Promise<Obj | undefined> {
    const r = await (await this.link()).request<Obj>('thread/read', { threadId }).catch((e: unknown) => {
      if (e instanceof RpcError && e.code < 0) throw e;
      return null;
    });
    return obj(r?.thread);
  }

  // A thread's conversation so far, as the chat shows it, read without loading or joining it.
  async readItems(threadId: string): Promise<Entry[]> {
    const rpc = await this.link();
    const entries: Entry[] = [];
    let cursor: string | null = null;
    do {
      const page: Obj = await rpc.request<Obj>('thread/items/list', { threadId, limit: ITEMS_PAGE, ...(cursor && { cursor }) });
      for (const d of Array.isArray(page.data) ? page.data : []) {
        const at = obj(d)?.startedAtMs;
        entries.push(...entriesOf(obj(d)?.item, typeof at === 'number' ? new Date(at).toISOString() : undefined));
      }
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : null;
    } while (cursor);
    return entries;
  }

  lastReply(session: string): string | null {
    return this.threadOf(session)?.said || null;
  }

  asks(session: string): Ask[] {
    return [...(this.threadOf(session)?.asks.values() ?? [])].map((a) => a.ask);
  }

  answer(session: string, askId: string, answer: Answer): boolean {
    const t = this.threadOf(session);
    const held = t?.asks.get(askId);
    if (!t || !held || !this.rpc?.respond(held.requestId, decisionOf(held.method, held.params, answer))) return false;
    t.asks.delete(askId);
    this.host.asksChanged(session);
    return true;
  }

  // A message for the thread, under the id it was sent with, which comes back on the item it makes. A turn
  // started while one runs goes into that one.
  async send(session: string, text: string, qid: string): Promise<void> {
    const t = this.threadOf(session);
    if (!t) throw new Error('this Codex session has no thread yet');
    const rpc = await this.link();
    try {
      await rpc.request('turn/start', { threadId: t.threadId, clientUserMessageId: qid, input: inputOf(text) });
    } catch (e) {
      // Asked and not answered, it may have gone in: it is not sent again.
      if (e instanceof RpcError && e.code === RpcError.TIMEOUT) throw Object.assign(e, { mayHaveRun: true });
      throw e;
    }
  }

  async rename(threadId: string, name: string): Promise<void> {
    await (await this.link()).request('thread/name/set', { threadId, name });
  }

  close(): void {
    this.closed = true;
    this.rpc?.close();
  }

  private threadOf(session: string): Thread | undefined {
    const id = this.bySession.get(session);
    return id ? this.threads.get(id) : undefined;
  }

  private track(session: string, threadId: string): Thread {
    const known = this.threads.get(threadId);
    if (known) return known;
    const t: Thread = {
      session,
      threadId,
      joined: false,
      joining: null,
      // Until the app server says otherwise: a thread runs no turn when it starts. What the session showed
      // before (a wait read off its TUI's screen) was not the thread's.
      status: 'idle',
      compacting: false,
      asks: new Map(),
      files: new Map(),
      live: new Map(),
      liveTimer: null,
      said: '',
    };
    this.threads.set(threadId, t);
    this.bySession.set(session, threadId);
    void this.join(t);
    return t;
  }

  private link(): Promise<CodexRpc> {
    if (this.rpc?.open) return Promise.resolve(this.rpc);
    this.connecting ??= connectAppServer(this.options)
      .then((rpc) => {
        this.rpc = rpc;
        this.retryMs = RETRY_MIN_MS;
        rpc.onNotification((n) => this.notes.notified(n));
        rpc.onRequest((r) => this.notes.requested(r));
        rpc.onClose(() => this.lost(rpc));
        for (const t of this.threads.values()) {
          t.joined = false;
          void this.join(t);
        }
        void this.findStarted(rpc).catch(() => {});
        return rpc;
      })
      .catch((e: unknown) => {
        this.retryAt = Date.now() + this.retryMs;
        this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
        this.host.log('codex app server unreachable', { error: e instanceof Error ? e.message : String(e) });
        throw e;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  // Threads started while this server was not listening (restarted while a TUI asked trust this folder?),
  // for the sessions still without one.
  private async findStarted(rpc: CodexRpc): Promise<void> {
    if (!this.host.sessions().some((s) => !s.threadId)) return;
    const { data } = await rpc.request<{ data?: unknown }>('thread/loaded/list', {});
    for (const threadId of Array.isArray(data) ? data.map(str) : []) {
      if (!threadId || this.threads.has(threadId)) continue;
      const { thread } = await rpc.request<{ thread?: unknown }>('thread/read', { threadId });
      this.notes.started(obj(thread));
    }
  }

  // What the app server held for the phone went with it; the TUIs that were on it are gone too. The next
  // listing connects again, starting it if need be.
  private lost(rpc: CodexRpc): void {
    if (this.rpc !== rpc) return;
    this.rpc = null;
    for (const t of this.threads.values()) {
      t.joined = false;
      if (t.asks.size) {
        t.asks.clear();
        this.host.asksChanged(t.session);
      }
    }
    if (!this.closed) this.host.log('codex app server connection lost', {});
  }

  // Joins the thread and takes what it holds so far into the journal. One not written yet is joined after
  // its first turn starts.
  private join(t: Thread): Promise<void> {
    if (t.joined || !this.rpc?.open) return Promise.resolve();
    t.joining ??= (async () => {
      const rpc = this.rpc!;
      try {
        const r = await rpc.request<Obj>('thread/resume', { threadId: t.threadId, excludeTurns: true });
        t.joined = true;
        t.model = str(r.model) || t.model;
        t.effort = str(r.reasoningEffort) || t.effort;
        this.notes.statusIs(t, obj(obj(r.thread)?.status));
        this.notes.nameIs(t, obj(r.thread)?.name);
        this.notes.usage(t);
        await this.backfill(rpc, t);
      } catch (e) {
        if (notWrittenYet(e)) {
          const thread = obj((await rpc.request<Obj>('thread/read', { threadId: t.threadId }).catch(() => null))?.thread);
          this.notes.ranOn(t, thread);
          this.notes.statusIs(t, obj(thread?.status));
        } else this.host.log('codex thread not joined', { session: t.session, thread: t.threadId, error: e instanceof Error ? e.message : String(e) });
      } finally {
        t.joining = null;
      }
    })();
    return t.joining;
  }

  private async backfill(rpc: CodexRpc, t: Thread): Promise<void> {
    let cursor: string | null = null;
    do {
      const page: Obj = await rpc.request<Obj>('thread/items/list', { threadId: t.threadId, limit: ITEMS_PAGE, ...(cursor && { cursor }) });
      const entries = (Array.isArray(page.data) ? page.data : []).flatMap((d: unknown) => {
        const at = obj(d)?.startedAtMs;
        return entriesOf(obj(d)?.item, typeof at === 'number' ? new Date(at).toISOString() : undefined);
      });
      if (entries.length && this.threads.get(t.threadId) === t) this.host.journal.putAgentItems(t.session, t.threadId, entries);
      const reply = entries.findLast((e) => e.item.k === 'text')?.item;
      if (reply?.k === 'text') t.said = reply.text;
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : null;
    } while (cursor);
  }

}
