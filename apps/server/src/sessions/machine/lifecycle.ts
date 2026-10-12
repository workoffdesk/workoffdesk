import { randomBytes, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { findTranscript } from '../../agents/claude/transcript/transcriptFile.js';
import { listMacClaudes, openStatus, stopMacProcess, type MacClaude, type MacOpen } from '../../agents/claude/terminals.js';
import { tuiCommand } from '../../agents/codex/appServer.js';
import type { CodexOnMac } from '../../agents/codex/threads.js';
import type { Titles } from '../../journal/ingest.js';
import { expandHome, isDir } from '../../system/dirs.js';
import { Conflict, InvalidRequest, NotFound } from '../../system/errors.js';
import { m } from '../../system/messages.js';
import type { SessionMeta } from '../../system/store.js';
import { quitAgent, shellBusy } from '../panes.js';
import { tmuxName } from '../sessionName.js';
import { environmentOf, fromTerminal } from '../terminalEnv.js';
import { CHAT_SIZE, ID, UUID, codexOf, nameConversation, nameLine, sessionTitle, type MachineDeps, type MachineState, type Parts } from './state.js';
import type { ConversationResume, CreateSpec, TermSession } from './types.js';

// How long a new Claude is waited for to say it started; after that it is taken as at its prompt anyway.
const STARTING_MAX_MS = 20_000;

// How long a Claude asked to quit, to start again on another account, is waited for.
const MOVE_QUIT_MS = 5_000;

// A program in the alternate screen keeps its output out of the scrollback, where a dialog taller than the screen starts.
// Claude Code goes there by default; this keeps it inline, for claude typed into a shell session too.
const KEEP_OUTPUT_IN_SCROLLBACK = { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1' };

const folderGone = (path: string) => new InvalidRequest(m.folderGone(path), 'folder-gone');

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function newId(): string {
  const n = randomBytes(8).readBigUInt64BE() % 36n ** 8n;
  return n.toString(36).padStart(8, '0');
}

// Starting and ending sessions: new, gone on with, taken over from the Mac, restarted, killed, named.
export class Lifecycle {
  constructor(
    private readonly s: MachineState,
    private readonly d: MachineDeps,
    private readonly p: Parts,
  ) {}

  async createSession(spec: CreateSpec): Promise<TermSession> {
    if (spec.kind !== 'shell' && spec.resumeId !== undefined && !UUID.test(spec.resumeId)) {
      throw new InvalidRequest('resume id must be a uuid');
    }
    if (spec.kind === 'shell' || !spec.resumeId) return this.startSession(spec, newId());
    const sid = spec.resumeId;
    return this.resumeOnce(sid, () => (spec.kind === 'claude' ? this.resumeClaude({ ...spec, resumeId: sid }) : this.resumeCodex({ ...spec, resumeId: sid })));
  }

  async continueSession(id: string): Promise<TermSession> {
    if (!ID.test(id)) throw new InvalidRequest('bad session id');
    const past = this.d.store.get().past[id];
    if (past?.kind === 'codex' && past.codexThreadId) {
      const tid = past.codexThreadId;
      return this.resumeOnce(tid, () => this.resumeCodex({ kind: 'codex', cwd: past.cwd, resumeId: tid }));
    }
    const meta = past ?? this.d.store.get().sessions[id];
    if (!meta) throw new NotFound('no such session');
    const sid = meta.claudeSessionId;
    if (meta.kind !== 'claude' || !sid) throw new InvalidRequest(m.goOn.onlyClaude);
    return this.resumeOnce(sid, () => this.resumeClaude({ kind: 'claude', cwd: meta.cwd, resumeId: sid }, id));
  }

  // Asked again while a conversation is being gone on with, the same start answers.
  private resumeOnce(sid: string, start: () => Promise<TermSession>): Promise<TermSession> {
    const now = this.s.resuming.get(sid);
    if (now) return now;
    const next = start().finally(() => this.s.resuming.delete(sid));
    this.s.resuming.set(sid, next);
    return next;
  }

  // One Claude writes a conversation at a time: the one open here is the one gone on with, and one open in
  // a terminal on the Mac is quit there before it is resumed here, or it is not resumed. A session here whose
  // Claude quit holding it goes on with it (`into`, when asked of that one), rather than a second session.
  private async resumeClaude(spec: ConversationResume & { kind: 'claude'; takeOver?: boolean; env?: Record<string, string> }, into?: string): Promise<TermSession> {
    if (spec.takeOver) this.p.takeOvers.cancel(spec.resumeId);
    const here = (await this.p.sessions.listSessions()).filter((s) => s.claudeSessionId === spec.resumeId);
    // Asked of its process: the listing does not look at a session while it is gone on with.
    for (const s of here) if (s.status !== 'ended' && (await this.p.status.agentRuns(s.id))) return s;
    const quit = here.find((s) => s.id === into) ?? here[0];
    if (!isDir(expandHome(spec.cwd, homedir()))) throw folderGone(spec.cwd);
    const there = (await this.openOnMac()).get(spec.resumeId);
    const id = quit?.id ?? newId();
    if (there) {
      if (!spec.takeOver) throw new Conflict(m.takeOver.openOnMac(there.claudes.map((c) => c.tty), 'Claude'), 'open-on-mac');
      spec = { ...spec, env: spec.env ?? (await environmentOf(there.claudes[0].pid)) };
      const stopped = await Promise.all(there.claudes.map((c) => stopMacProcess(c, m.takeOver.goneToPhone(id))));
      if (stopped.includes(false)) throw new Conflict(m.takeOver.wouldNotQuit('Claude'), 'mac-would-not-quit');
    }
    if (!quit) return this.startSession(spec, id);
    if (quit.past) {
      if (this.d.claudeProjectsRoot && !(await findTranscript(this.d.claudeProjectsRoot, spec.resumeId).catch(() => null))) throw conversationGone('Claude');
      return this.revive(id, spec);
    }
    // The shell its Claude left is not ended while something runs in it.
    const pane = await this.d.tmux.panePid(tmuxName(id));
    if (pane && (await shellBusy(pane))) throw new Conflict(m.goOn.terminalBusy, 'terminal-busy');
    return this.restartClaude(id, spec);
  }

  // A session's Claude quit and started again in its pane on the account in use, going on with its conversation, as
  // one resume of it, so nothing takes the moment between the two for Claude having quit. The Claudes in terminals on
  // the Mac holding the conversation are quit first (quitOnMac, its refusals as they are). One whose Claude does not
  // quit, or could not start again for its folder being gone, is left as it was.
  moveClaude(id: string, forceMac = false): Promise<TermSession> {
    const meta = this.d.store.get().sessions[id];
    const sid = meta?.claudeSessionId;
    if (!sid) return Promise.reject(new NotFound('no such session'));
    if (!isDir(meta.cwd)) return Promise.reject(folderGone(meta.cwd));
    return this.resumeOnce(sid, async () => {
      this.p.status.setStatus(id, 'starting');
      const stay = (e: Error) => {
        this.s.statuses.delete(id);
        void this.p.status.fillStatus(id);
        throw e;
      };
      await this.quitOnMac(sid, id, forceMac).catch(stay);
      const pane = await this.d.tmux.panePid(tmuxName(id)).catch(() => undefined);
      if (!pane || !(await quitAgent(pane, MOVE_QUIT_MS))) stay(new Error(`its Claude did not quit within ${MOVE_QUIT_MS / 1000} seconds, and it stays on its account`));
      return this.restartClaude(id, { resumeId: sid });
    });
  }

  async quitOthersOnMac(id: string, force = false): Promise<void> {
    const meta = this.d.store.get().sessions[id];
    if (!meta) throw new NotFound('no such session');
    if (meta.claudeSessionId) await this.quitOnMac(meta.claudeSessionId, id, force);
  }

  // Each Claude in a terminal on the Mac holding a conversation quit, and told the session it went on in; unless
  // force, none quit while one there is at work or asking. The sessions here then learn it is open there no longer.
  async quitOnMac(sid: string, goneTo: string, force = false): Promise<void> {
    const there = (await this.openOnMac()).get(sid);
    if (!there) return;
    if (!force && there.status !== 'idle') throw new Conflict(m.moveThis.macBusy, 'open-on-mac-busy');
    const stopped = await Promise.all(there.claudes.map((c) => stopMacProcess(c, m.takeOver.goneToPhone(goneTo))));
    await this.openOnMac();
    if (stopped.includes(false)) throw new Conflict(m.takeOver.wouldNotQuit('Claude'), 'mac-would-not-quit');
  }

  // As for Claude, by the thread's writer lock: whoever holds it writes the thread, and Codex lets no one else.
  // A Codex in a terminal is quit there first; another app's is left alone, and the thread is not resumed.
  // The taken-over Codex's environment stays behind: its commands run in this server's app server.
  private async resumeCodex(spec: ConversationResume & { kind: 'codex'; takeOver?: boolean }): Promise<TermSession> {
    if (spec.takeOver) this.p.takeOvers.cancel(spec.resumeId);
    const here = (await this.p.sessions.listSessions()).find((s) => s.codexThreadId === spec.resumeId);
    if (here && !here.past) return here;
    if (!isDir(expandHome(spec.cwd, homedir()))) throw folderGone(spec.cwd);
    const thread = await this.codexWhere(spec.resumeId);
    if (here && !thread) throw conversationGone('Codex');
    const holder = thread?.holder;
    const id = here?.id ?? newId();
    if (holder?.at === 'elsewhere') throw new Conflict(m.takeOver.openElsewhere, 'open-elsewhere');
    if (holder?.at === 'terminal') {
      if (!spec.takeOver) throw new Conflict(m.takeOver.openOnMac([holder.tty], 'Codex'), 'open-on-mac');
      if (!(await stopMacProcess(holder, m.takeOver.goneToPhone(id)))) throw new Conflict(m.takeOver.wouldNotQuit('Codex'), 'mac-would-not-quit');
    }
    const codex = { kind: 'codex' as const, cwd: spec.cwd, resumeId: spec.resumeId, title: spec.title };
    return here ? this.revive(id, codex) : this.startSession(codex, id);
  }

  // A past session started again in place, going on with its conversation: the same id, name and journal. A name
  // given it while it was past is given its agent's conversation too.
  private async revive(id: string, spec: CreateSpec): Promise<TermSession> {
    const was = this.d.store.get().past[id]!;
    const started = await this.startSession(spec, id);
    this.d.store.update((st) => {
      delete st.past[id];
      const now = st.sessions[id];
      if (!now) return;
      const { title, named, customTitle, aiTitle, createdAt, pinned } = was;
      Object.assign(now, { title, named, customTitle, aiTitle, createdAt, pinned });
      if (named && (spec.kind === 'claude' && spec.resumeId ? this.claudeName(spec.resumeId) : null) !== title) now.naming = title;
    });
    this.p.naming.watch();
    return (await this.p.sessions.listSessions()).find((s) => s.id === id) ?? started;
  }

  private codexWhere(threadId: string): Promise<CodexOnMac | null> {
    if (!this.d.codexThreads) throw new InvalidRequest('Codex is not set up on this Mac');
    return this.d.codexThreads.where(threadId);
  }

  // Each session here learns from it whether its conversation is open on the Mac too. recentMs: as
  // listMacClaudes takes it, for what is only shown.
  async openOnMac(recentMs = 0): Promise<Map<string, MacOpen>> {
    const open = new Map<string, MacClaude[]>();
    for (const c of await listMacClaudes(this.d.claudeBin, recentMs)) open.set(c.sessionId, [...(open.get(c.sessionId) ?? []), c]);
    for (const [id, meta] of Object.entries(this.d.store.get().sessions)) {
      if (meta.kind === 'claude' && meta.claudeSessionId) this.d.journal.onMac(id, open.get(meta.claudeSessionId)?.length ?? 0);
    }
    const transcript = (sid: string) => (this.d.claudeProjectsRoot ? findTranscript(this.d.claudeProjectsRoot, sid).catch(() => null) : null);
    return new Map(await Promise.all([...open].map(async ([sid, list]) => [sid, { claudes: list, status: await openStatus(list, () => transcript(sid)) }] as const)));
  }

  // Waited on, or being taken over now (Claude on the Mac quitting, the session here starting).
  takingOver(sid: string): boolean {
    return this.p.takeOvers.waiting(sid) || this.s.resuming.has(sid);
  }

  private async startSession(spec: CreateSpec, id: string): Promise<TermSession> {
    const cwd = spec.cwd ? expandHome(spec.cwd, homedir()) : homedir();
    if (!isDir(cwd)) throw folderGone(cwd);
    // A conversation gone on with keeps the name given it here; what it is called there comes from it.
    const resumed = spec.kind !== 'shell' && spec.resumeId;
    const given = resumed ? ((spec.kind === 'claude' && this.claudeName(resumed)) || undefined) : spec.title;
    const meta: SessionMeta = { title: sessionTitle(given, cwd), named: !!nameLine(given), kind: spec.kind, cwd, createdAt: Date.now() };
    // Claude is started with it; Codex's thread is named once it is known.
    if (spec.kind === 'codex' && meta.named) meta.naming = meta.title;
    let command: string | undefined;
    if (spec.kind === 'codex') {
      const codex = codexOf(this.d);
      await codex.start(id, spec.resumeId);
      if (spec.resumeId) meta.codexThreadId = spec.resumeId;
      command = tuiCommand({ sock: codex.options.sock, codexBin: codex.options.codexBin, shell: this.d.shell, cwd, resume: spec.resumeId });
    }
    if (spec.kind === 'claude') {
      meta.claudeSessionId = spec.resumeId ?? randomUUID();
      const claude = await this.claudeCommand(spec.resumeId ? { resume: spec.resumeId } : { sessionId: meta.claudeSessionId }, spec.env, nameLine(given) || undefined);
      command = claude.command;
      if (claude.dir !== undefined) meta.claudeDir = claude.dir;
      if (spec.env) meta.terminal = true;
    }
    await this.d.tmux.newSession(tmuxName(id), { cwd, command, env: this.sessionEnv(id, spec.kind === 'claude' ? spec.env : undefined), size: CHAT_SIZE });
    this.d.store.update((st) => {
      st.sessions[id] = meta;
    });
    // Until the agent says it has started, what is sent waits, rather than going to a shell still starting it.
    // Codex says so when its thread starts, however long its TUI asks something first.
    if (spec.kind !== 'shell') this.s.statuses.set(id, 'starting');
    if (spec.kind === 'claude') this.startingAtMost(id);
    await this.p.sessions.listSessions();
    return this.p.sessions.toSession(id, meta, Date.now());
  }

  // What a Claude session's pane runs: Claude, then a login shell once it ends, however it ends (panes.ts). It runs on
  // the account in use, or, started from a terminal (with that terminal's environment), on that terminal's; dir is
  // that account, when known. name: the name given the session here, which Claude takes for the conversation's.
  private async claudeCommand(conversation: { resume: string } | { sessionId: string }, terminal?: Record<string, string>, name?: string): Promise<{ command: string; dir?: string }> {
    const idArgs = `${'resume' in conversation ? `--resume ${shq(conversation.resume)}` : `--session-id ${shq(conversation.sessionId)}`}${name ? ` --name ${shq(name)}` : ''}`;
    const account = terminal ? undefined : await this.p.accounts.accountInUse();
    const dirArgs = account === undefined ? '' : account ? `env CLAUDE_CONFIG_DIR=${shq(account)} ` : 'env -u CLAUDE_CONFIG_DIR ';
    const dir = terminal ? this.d.accounts?.idOf(terminal.CLAUDE_CONFIG_DIR) : (account ?? this.d.accounts?.ownId());
    const inner = `${dirArgs}${shq(this.d.claudeBin)} ${idArgs} --settings ${shq(this.d.claudeSettingsPath)}${this.d.claudeArgs.map((a) => ` ${shq(a)}`).join('')}; exec ${shq(this.d.shell)} -l`;
    return { command: `${shq(this.d.shell)} -lc ${shq(inner)}`, dir };
  }

  // terminal: the environment of the terminal on the Mac the conversation was taken over from.
  private sessionEnv(id: string, terminal?: Record<string, string>): Record<string, string> {
    return { ...(terminal ? fromTerminal(terminal) : {}), WORKOFFDESK_SESSION: id, ...KEEP_OUTPUT_IN_SCROLLBACK };
  }

  private startingAtMost(id: string): void {
    this.s.later(STARTING_MAX_MS, () => this.s.statuses.get(id) === 'starting' && this.p.status.setStatus(id, 'idle'));
  }

  // The pane of a session whose Claude quit runs Claude again in its place, going on with its conversation. A
  // conversation nothing was said in yet has no transcript to resume, and starts again under its own id.
  private async restartClaude(id: string, spec: { resumeId: string; env?: Record<string, string> }): Promise<TermSession> {
    const name = tmuxName(id);
    const pane = await this.d.tmux.panePid(name);
    if (!pane) throw new NotFound('no such session');
    const meta = this.d.store.get().sessions[id]!;
    if (!isDir(meta.cwd)) throw folderGone(meta.cwd);
    const said = this.d.claudeProjectsRoot ? await findTranscript(this.d.claudeProjectsRoot, spec.resumeId).catch(() => null) : true;
    this.p.status.setStatus(id, 'starting');
    try {
      const given = meta.named === false ? undefined : nameLine(meta.title) || undefined;
      const claude = await this.claudeCommand(said ? { resume: spec.resumeId } : { sessionId: spec.resumeId }, spec.env, given);
      await this.d.tmux.respawnPane(name, { cwd: meta.cwd, command: claude.command, env: this.sessionEnv(id, spec.env) });
      this.p.naming.taken(id);
      this.d.store.update((st) => {
        const now = st.sessions[id];
        if (!now) return;
        delete now.naming;
        if (claude.dir !== undefined) now.claudeDir = claude.dir;
        if (spec.env) now.terminal = true;
        else delete now.terminal;
      });
    } catch (e) {
      this.p.status.claudeQuit(id);
      throw e;
    }
    this.startingAtMost(id);
    return (await this.p.sessions.listSessions()).find((s) => s.id === id) ?? this.p.sessions.toSession(id, meta, Date.now());
  }

  // Ends a running session, which keeps it as past; deletes a past one, and what its journal held.
  async killSession(id: string): Promise<void> {
    if (!ID.test(id)) throw new InvalidRequest('bad session id');
    if (this.d.store.get().past[id]) {
      this.d.store.update((st) => delete st.past[id]);
      this.d.journal.drop(id);
      this.s.emit();
      return;
    }
    await this.d.tmux.killSession(tmuxName(id));
    await this.p.sessions.listSessions();
  }

  async pinSession(id: string, on: boolean): Promise<boolean> {
    if (!ID.test(id)) throw new InvalidRequest('bad session id');
    const st = this.d.store.get();
    const meta = st.past[id] ?? ((await this.p.sessions.exists(id)) ? st.sessions[id] : undefined);
    if (!meta) return false;
    if (!!meta.pinned === on) return true;
    this.d.store.update((next) => {
      const now = next.past[id] ?? next.sessions[id];
      if (!now) return;
      if (on) now.pinned = Date.now();
      else delete now.pinned;
    });
    this.s.emit();
    return true;
  }

  async renameSession(id: string, title: string): Promise<TermSession | null> {
    if (!ID.test(id)) throw new InvalidRequest('bad session id');
    const name = nameLine(title);
    if (!name) throw new InvalidRequest('a name cannot be empty');
    if (this.d.store.get().past[id]) {
      this.d.store.update((st) => Object.assign(st.past[id], { title: name, named: true }));
      this.s.emit();
      return (await this.p.sessions.listSessions()).find((s) => s.id === id) ?? null;
    }
    const meta = this.d.store.get().sessions[id];
    if (!meta || !(await this.p.sessions.exists(id))) return null;
    // The name its agent has, or is being given: nothing to give it again.
    if ((meta.naming ?? meta.customTitle) === name) return (await this.p.sessions.listSessions()).find((s) => s.id === id) ?? null;
    this.d.store.update((st) => {
      const now = st.sessions[id];
      if (!now) return;
      now.title = name;
      now.named = true;
      now.naming = name;
      if (now.claudeSessionId) nameConversation(st, now.claudeSessionId, name);
    });
    this.s.emit();
    this.p.naming.watch();
    return (await this.p.sessions.listSessions()).find((s) => s.id === id) ?? null;
  }

  // What the agent calls a session's conversation. Read from its start, the names it was given there;
  // after, one given by /rename is given as one given here is, the latest name given being the one kept.
  // While a name given here is on its way, only that name counts: any other is one the agent held before.
  conversationNamed(id: string, found: Titles, fresh: boolean): void {
    const meta = this.d.store.get().sessions[id];
    if (!meta) return;
    const written = nameLine(found.custom) || undefined;
    const taken = !!meta.naming && written === meta.naming;
    const custom = meta.naming && !taken ? undefined : written;
    const ai = nameLine(found.ai) || undefined;
    const customTitle = fresh ? custom : (custom ?? meta.customTitle);
    const aiTitle = fresh ? ai : (ai ?? meta.aiTitle);
    const renamed = taken || (!fresh && !!custom && meta.named !== false);
    if (customTitle === meta.customTitle && aiTitle === meta.aiTitle && !renamed) return;
    if (taken) this.p.naming.taken(id);
    this.d.store.update((st) => {
      const now = st.sessions[id];
      if (!now) return;
      now.customTitle = customTitle;
      now.aiTitle = aiTitle;
      if (!renamed) return;
      if (taken) delete now.naming;
      now.named = false;
      if (now.claudeSessionId) nameConversation(st, now.claudeSessionId, '');
    });
    this.s.emit();
  }

  claudeName(claudeSessionId: string): string | null {
    return this.d.store.get().claudeNames[claudeSessionId] ?? null;
  }
}

// A conversation its agent no longer keeps: what was said can be read here, not gone on with.
const conversationGone = (agent: string) => new Conflict(m.goOn.conversationGone(agent), 'conversation-gone');
