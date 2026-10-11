import { dirname, join } from 'node:path';
import type { AccountsView, ClaudeAccounts } from '../agents/claude/accounts.js';
import { PermissionAsks, type HeldHook, type PermissionPayload } from '../agents/claude/hooks/asks.js';
import type { Choices } from '../agents/claude/screen/choices.js';
import { ClaudeScreen } from '../agents/claude/screen/screen.js';
import type { MacOpen } from '../agents/claude/terminals.js';
import type { Usage } from '../agents/claude/usage.js';
import { CodexAgent } from '../agents/codex/agent.js';
import type { Entry } from '../agents/codex/items.js';
import { CodexThreads, type CodexOnMac } from '../agents/codex/threads.js';
import type { Answer, ClaudeStatus } from '../agents/types.js';
import { sqliteAvailable } from '../journal/db.js';
import { Journal, type JournalLog, type Row } from '../journal/index.js';
import { Conflict, InvalidRequest } from '../system/errors.js';
import { shownTitle, type PastSession, type SessionMeta, type Store } from '../system/store.js';
import type { Tmux } from '../system/tmux.js';
import { Accounts } from './machine/accounts.js';
import { Moves } from './machine/moves.js';
import { Naming } from './machine/naming.js';
import { Input } from './machine/input.js';
import { Lifecycle } from './machine/lifecycle.js';
import { CHAT_SIZE, ID, MachineState, UUID, codexOf, type MachineDeps, type Parts } from './machine/state.js';
import { Status } from './machine/status.js';
import type { ConversationResume, CreateSpec, Machine, OnScreen, StatusNotifier, TermSession } from './machine/types.js';
import { Outbox, migrateQueueFile, type Queued } from './outbox.js';
import { idOfTmuxName, tmuxName } from './sessionName.js';

export * from './machine/types.js';

// A message held back because a dialog, not the prompt, would have taken it.
class DialogOpen extends Error {}
// A message held back because Claude quit, and the shell it left behind would run it.
class AgentQuit extends Error {}

// The sessions on this Mac. The work is done by its parts in machine/; this holds them together, lists the
// sessions, and is what the rest of the server talks to.
export class LocalMachine implements Machine {
  readonly id = 'local';
  readonly asks = new PermissionAsks((id) => this.journal.asks(id, this.asks.list(id)));
  // Everything a session's page shows, as rows a copy catches up on (journal/), the outbox's messages too.
  readonly journal: Journal;
  private readonly s = new MachineState();
  private readonly d: MachineDeps;
  private readonly p: Parts;
  // Per session, the last message still being taken in.
  private readonly sending = new Map<string, Promise<unknown>>();
  private lastIds = '';
  // When something last happened in each running session, as the last listing saw it.
  private readonly seen = new Map<string, number>();

  constructor(deps: {
    tmux: Tmux;
    store: Store;
    claudeSettingsPath: string;
    claudeBin?: string;
    shell?: string;
    claudeArgs?: string[];
    // Where Claude Code keeps its transcripts, read for whether a turn is over; none, and only the hooks say.
    claudeProjectsRoot?: string;
    // The Claude accounts on the Mac, one of which can be picked for the sessions started here.
    claudeAccounts?: ClaudeAccounts;
    // Where waiting messages were kept before the journal, read into it once; beside the store unless given.
    queueFile?: string;
    // In memory unless given.
    journal?: { file: string; log: JournalLog };
    // Codex's CLI, the socket of the app server its sessions share, and the CODEX_HOME that server uses.
    codex?: { bin: string; sock: string; home: string };
  }) {
    const claude = new ClaudeScreen(deps.tmux, CHAT_SIZE.cols);
    if (!sqliteAvailable()) throw new Error(`WorkOffDesk needs Node 22.13 or later (this is ${process.versions.node}).`);
    this.journal = new Journal({
      file: ':memory:',
      log: () => {},
      ...deps.journal,
      root: deps.claudeProjectsRoot,
      titled: (id, found, fresh) => this.p.lifecycle.conversationNamed(id, found, fresh),
    });
    migrateQueueFile(deps.queueFile ?? join(dirname(deps.store.file), 'queue.json'), this.journal);
    const outbox = new Outbox({
      store: this.journal,
      status: (id) => this.getStatus(id),
      // Claude is at work on it from the moment it goes in: the next waits until it is done, not until a
      // hook says it started.
      deliver: async (id, text, qid) => {
        if (deps.store.get().sessions[id]?.kind === 'codex') return codexOf(this.d).send(id, text, qid);
        if (!(await this.p.status.agentRuns(id))) throw new AgentQuit();
        if (await this.p.input.dialogOpen(id)) throw new DialogOpen();
        await this.p.input.paste(id, text);
        // A slash command may only open a dialog, which no hook reports the end of.
        if (!text.startsWith('/') && (this.s.statuses.get(id) === 'idle' || !this.s.statuses.has(id))) this.setStatus(id, 'working');
      },
      changed: () => this.s.emit(),
      failed: (id, e) => e instanceof DialogOpen || e instanceof AgentQuit || console.error(`workoffdesk: a message to session ${id} could not go and waits: ${e instanceof Error ? e.message : String(e)}`),
    });
    const shell = deps.shell ?? process.env.SHELL ?? '/bin/zsh';
    const log = deps.journal?.log ?? (() => {});
    const codex = deps.codex
      ? new CodexAgent(
          { tmux: deps.tmux, sock: deps.codex.sock, codexBin: deps.codex.bin, shell },
          {
            journal: this.journal,
            sessions: () => Object.entries(deps.store.get().sessions).flatMap(([id, m]) => (m.kind === 'codex' ? [{ id, cwd: m.cwd, createdAt: m.createdAt, threadId: m.codexThreadId }] : [])),
            setThread: (id, threadId) => {
              deps.store.update((st) => void (st.sessions[id] && (st.sessions[id].codexThreadId = threadId)));
              this.p.naming.watch();
            },
            moved: (id, status, said) => this.p.status.moved(id, status, said),
            named: (id, name) => this.p.lifecycle.conversationNamed(id, { ai: name }, false),
            setUsage: (id, usage) => this.setUsage(id, usage),
            asksChanged: (id) => {
              this.journal.asks(id, this.d.codex?.asks(id) ?? []);
              this.s.emit();
            },
            log: (msg, o) => log(msg, o),
          },
        )
      : null;
    this.d = {
      tmux: deps.tmux,
      claude,
      store: deps.store,
      journal: this.journal,
      outbox,
      asks: this.asks,
      codex,
      codexThreads: codex && deps.codex ? new CodexThreads({ agent: codex, sock: deps.codex.sock, codexHome: deps.codex.home }) : null,
      accounts: deps.claudeAccounts ?? null,
      claudeSettingsPath: deps.claudeSettingsPath,
      claudeBin: deps.claudeBin ?? 'claude',
      shell,
      claudeArgs: deps.claudeArgs ?? [],
      claudeProjectsRoot: deps.claudeProjectsRoot,
    };
    const p = {} as Parts;
    p.sessions = this;
    p.lifecycle = new Lifecycle(this.s, this.d, p);
    p.input = new Input(this.s, this.d, p);
    p.status = new Status(this.s, this.d, p);
    p.accounts = new Accounts(this.d, p);
    p.moves = new Moves(this.s, this.d, p);
    p.naming = new Naming(this.s, this.d, p);
    this.p = p;
    p.naming.watch();
  }

  codexOnMac = async (): Promise<CodexOnMac[]> => (this.d.codexThreads ? this.d.codexThreads.list() : []);
  // Every Codex thread people opened on the Mac, however old.
  allCodexOnMac = async (): Promise<CodexOnMac[]> => (this.d.codexThreads ? this.d.codexThreads.all() : []);
  // One Codex thread, however old; null when there is none.
  oneCodexOnMac = async (id: string): Promise<CodexOnMac | null> => (this.d.codexThreads ? this.d.codexThreads.where(id).catch(() => null) : null);

  codexChat(threadId: string): Promise<Entry[]> {
    if (!UUID.test(threadId)) throw new InvalidRequest('thread id must be a uuid');
    return codexOf(this.d).readItems(threadId);
  }

  // What Codex said last in a session, for the list.
  lastReply(id: string): string | null {
    return this.d.codex?.lastReply(id) ?? null;
  }

  // Where a change of status is told, for the sessions whose agent the server follows itself (Codex).
  setNotifier(n: StatusNotifier): void {
    this.s.notifier = n;
  }

  // Which agents a session can be started with here, besides Claude Code.
  get agents(): { codex: boolean } {
    return { codex: !!this.d.codex };
  }

  // A message as the journal has it, to answer what was done to it with.
  message(id: string, qid: string): Row | null {
    return this.journal.message(id, qid);
  }

  // Stops what writes to the journal, then the journal.
  closeJournal(): void {
    this.d.codex?.close();
    for (const stop of this.s.transcriptWatches.values()) stop();
    this.s.transcriptWatches.clear();
    this.s.stopTimers();
    this.journal.close();
  }

  // Takes what the session's conversation added into the journal.
  ingest(id: string): Promise<void> {
    return this.journal.ingest(id, this.d.store.get().sessions[id]?.claudeSessionId ?? null);
  }

  // Metadata is written only after tmux has the session, and the ids that may be
  // pruned are read before asking tmux; so a missing id here means tmux lost it.
  async listSessions(): Promise<TermSession[]> {
    const known = Object.keys(this.d.store.get().sessions);
    void this.d.accounts?.list().catch(() => {});
    const live = (await this.d.tmux.listSessions()).flatMap((t) => {
      const id = idOfTmuxName(t.name);
      return id === undefined ? [] : [{ ...t, id }];
    });
    const liveIds = new Set(live.map((t) => t.id));
    const stale = known.filter((id) => !liveIds.has(id));
    if (stale.length) this.leave(stale);
    const sessions = live.map(({ id, ...t }) => {
      const meta: SessionMeta = this.d.store.get().sessions[id] ?? {
        title: t.name,
        kind: 'shell',
        cwd: '',
        createdAt: t.created,
      };
      return { id, meta, activity: t.activity, panePid: t.panePid };
    });
    await this.p.status.followClaudes(sessions.flatMap((s) => (s.meta.kind === 'claude' && s.panePid ? [{ id: s.id, panePid: s.panePid }] : [])));
    // A status not known yet is read before it is told: Claude may be at work behind its prompt.
    await Promise.all(sessions.map((s) => s.meta.kind === 'claude' && this.p.status.fillStatus(s.id)));
    for (const s of sessions) if (s.meta.kind === 'claude') this.p.status.look(s.id);
    for (const s of sessions) if (s.meta.kind === 'codex') this.p.status.lookCodex(s.id, s.meta);
    for (const s of sessions) this.seen.set(s.id, s.activity);
    const past = this.d.store.get().past;
    const ids = `${[...liveIds].sort().join(',')}|${Object.keys(past).sort().join(',')}`;
    if (ids !== this.lastIds) {
      this.lastIds = ids;
      this.s.emit();
    }
    const running = sessions.map((s) => this.toSession(s.id, s.meta, s.activity));
    const held = new Set(running.flatMap((s) => conversationOf(s) ?? []));
    const kept = Object.entries(past).flatMap(([id, p]) => (held.has(conversationOf(p) ?? '') ? [] : [this.toPast(id, p)]));
    return [...running, ...kept].sort((a, b) => b.lastActivity - a.lastActivity);
  }

  // Sessions tmux no longer has. A Claude or Codex one is kept as past, with its journal, unless a past one of
  // the same conversation has more of it; a shell one is dropped.
  private leave(ids: string[]): void {
    const dropped: string[] = [];
    this.d.store.update((st) => {
      for (const id of ids) {
        const meta = st.sessions[id];
        delete st.sessions[id];
        const conv = meta && conversationOf(meta);
        const other = conv ? Object.keys(st.past).find((p) => conversationOf(st.past[p]) === conv) : undefined;
        if (!meta || meta.kind === 'shell' || (other && this.journal.itemCount(other) > this.journal.itemCount(id))) {
          dropped.push(id);
          continue;
        }
        if (other) {
          delete st.past[other];
          dropped.push(other);
        }
        st.past[id] = { ...meta, lastActivity: this.seen.get(id) ?? meta.createdAt };
      }
    });
    for (const id of ids) {
      this.p.status.forget(id);
      this.seen.delete(id);
    }
    for (const id of dropped) this.journal.drop(id);
  }

  // Gone from tmux and kept to read.
  isPast(id: string): boolean {
    return Object.hasOwn(this.d.store.get().past, id);
  }

  async exists(id: string): Promise<boolean> {
    return ID.test(id) && this.d.tmux.hasSession(tmuxName(id));
  }

  // Taken in the order they arrive: each waits until the one before it went in or was queued.
  sendMessage(id: string, text: string, qid?: string): Promise<Queued | null> {
    if (!ID.test(id)) return Promise.reject(new InvalidRequest('bad session id'));
    const taken = (this.sending.get(id) ?? Promise.resolve()).then(async () => {
      // A compaction in a session that reports none shows only on screen.
      await this.p.input.onScreen(id).catch(() => {});
      // Nor does a status not known yet go for idle: Claude may be at work behind its prompt.
      if (this.d.store.get().sessions[id]?.kind === 'claude') await this.p.status.fillStatus(id);
      return this.d.outbox.send(id, text, qid);
    });
    const last = taken.catch(() => {});
    this.sending.set(id, last);
    void last.then(() => {
      if (this.sending.get(id) === last) this.sending.delete(id);
    });
    return taken;
  }

  unsend(id: string, queuedId: string): string | null {
    return this.d.outbox.remove(id, queuedId);
  }

  async sendNow(id: string, queuedId: string): Promise<boolean> {
    if (!ID.test(id)) throw new InvalidRequest('bad session id');
    if (await this.p.input.dialogOpen(id)) throw new Conflict('a dialog is open; pick an option or press Esc first', 'dialog-open');
    return this.d.outbox.sendNow(id, queuedId);
  }

  moveQueued(id: string, queuedId: string, by: -1 | 1): boolean {
    return this.d.outbox.move(id, queuedId, by);
  }

  createSession(spec: CreateSpec): Promise<TermSession> { return this.p.lifecycle.createSession(spec); }
  continueSession(id: string): Promise<TermSession> { return this.p.lifecycle.continueSession(id); }
  openOnMac(recentMs?: number): Promise<Map<string, MacOpen>> { return this.p.lifecycle.openOnMac(recentMs); }
  takeOverWhenIdle(spec: ConversationResume): Promise<TermSession | null> { return this.p.lifecycle.takeOverWhenIdle(spec); }
  takingOver(claudeSessionId: string): boolean { return this.p.lifecycle.takingOver(claudeSessionId); }
  cancelTakeOver(claudeSessionId: string): boolean { return this.p.lifecycle.cancelTakeOver(claudeSessionId); }
  killSession(id: string): Promise<void> { return this.p.lifecycle.killSession(id); }
  renameSession(id: string, title: string): Promise<TermSession | null> { return this.p.lifecycle.renameSession(id, title); }
  claudeName(claudeSessionId: string): string | null { return this.p.lifecycle.claudeName(claudeSessionId); }

  choices(id: string): Promise<Choices | null> { return this.p.input.choices(id); }
  onScreen(id: string): Promise<OnScreen> { return this.p.input.onScreen(id); }
  screenText(id: string): Promise<string> { return this.p.input.screenText(id); }
  choose(id: string, index: number, label: string, text?: string): Promise<boolean> { return this.p.input.choose(id, index, label, text); }
  tick(id: string, ticked: number[], labels: string[]): Promise<boolean> { return this.p.input.tick(id, ticked, labels); }
  holdPermission(id: string, payload: PermissionPayload, hook: HeldHook): boolean { return this.p.input.holdPermission(id, payload, hook); }
  answer(id: string, askId: string, answer: Answer): boolean { return this.p.input.answer(id, askId, answer); }
  type(id: string, text: string): Promise<void> { return this.p.input.type(id, text); }
  close(id: string): Promise<OnScreen> { return this.p.input.close(id); }
  press(id: string, keys: string): Promise<OnScreen> { return this.p.input.press(id, keys); }
  runCommand(id: string, command: string): Promise<{ ran: boolean; screen: OnScreen | null }> { return this.p.input.runCommand(id, command); }
  fitForChat(id: string): Promise<void> { return this.p.input.fitForChat(id); }

  getStatus(id: string): ClaudeStatus | null { return this.p.status.getStatus(id); }
  setStatus(id: string, status: ClaudeStatus): void { this.p.status.setStatus(id, status); }
  claudeMayHaveQuit(id: string): void { this.p.status.claudeMayHaveQuit(id); }
  compactStarted(id: string): void { this.p.status.compactStarted(id); }
  compactEnded(id: string, manual: boolean): void { this.p.status.compactEnded(id, manual); }
  setUsage(id: string, usage: Usage | null): void { this.p.status.setUsage(id, usage); }
  setClaudeSessionId(id: string, claudeSessionId: string): void { this.p.status.setClaudeSessionId(id, claudeSessionId); }

  claudeAccountsView(): Promise<AccountsView> { return this.p.accounts.claudeAccountsView(); }
  pickClaudeAccount(id: string): Promise<AccountsView> { return this.p.accounts.pickClaudeAccount(id); }
  async moveToAccountInUse(): Promise<AccountsView> {
    await this.p.moves.moveAll();
    return this.p.accounts.claudeAccountsView();
  }

  sessionMeta(id: string): SessionMeta | undefined {
    return this.d.store.get().sessions[id];
  }

  // How many sessions are running a turn or compacting.
  working(): number {
    return Object.keys(this.d.store.get().sessions).filter((id) => {
      const status = this.getStatus(id);
      return status === 'working' || status === 'compacting';
    }).length;
  }

  onChange(cb: () => void): () => void {
    this.s.listeners.add(cb);
    return () => this.s.listeners.delete(cb);
  }

  // One listing at a time: the next starts an interval after the last one ends, so a slow tmux
  // makes the watch slower instead of piling listings onto it.
  watch(intervalMs: number): () => void {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    const next = () => {
      if (stopped) return;
      timer = setTimeout(() => {
        this.listSessions().catch(() => {}).finally(next);
      }, intervalMs);
      timer.unref();
    };
    next();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }

  private toPast(id: string, p: PastSession): TermSession {
    const { lastActivity, ...meta } = p;
    return { ...this.toSession(id, meta, lastActivity), status: 'ended', usage: null, claudeAccount: undefined, past: true };
  }

  toSession(id: string, meta: SessionMeta, lastActivity: number): TermSession {
    return {
      id,
      title: shownTitle(meta),
      kind: meta.kind,
      cwd: meta.cwd,
      claudeSessionId: meta.claudeSessionId,
      codexThreadId: meta.codexThreadId,
      createdAt: meta.createdAt,
      lastActivity,
      status: meta.kind === 'shell' ? null : (this.s.statuses.get(id) ?? 'idle'),
      usage: this.s.usages.get(id) ?? null,
      claudeAccount: this.p.accounts.accountLabel(meta),
    };
  }
}

// The conversation a session holds, Claude's or Codex's.
const conversationOf = (s: { claudeSessionId?: string; codexThreadId?: string }) => s.claudeSessionId ?? s.codexThreadId;
