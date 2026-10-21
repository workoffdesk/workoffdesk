import { NOTHING_SHOWN } from '../../agents/claude/screen/screen.js';
import { findTranscript } from '../../agents/claude/transcript/transcriptFile.js';
import { notificationFor } from '../../agents/claude/hooks/status.js';
import { turnInTranscript } from '../../agents/claude/transcript/turn.js';
import type { Usage } from '../../agents/claude/usage.js';
import { watchTranscript } from '../../agents/claude/transcript/watch.js';
import type { ClaudeStatus } from '../../agents/types.js';
import { shownTitle, type SessionMeta } from '../../system/store.js';
import { agentsRunning } from '../panes.js';
import { tmuxName } from '../sessionName.js';
import { UUID, nameConversation, type MachineDeps, type MachineState, type Parts } from './state.js';

// A turn the transcript says is over, while no hook said so, is taken as over this long after: the hook
// for it may be on its way, and Claude may go on at once with what it was sent meanwhile.
const TURN_OVER_AFTER_MS = 10_000;
// How often a session working with no word from the hooks has its transcript read.
const TURN_LOOK_MS = 5_000;

// Following each agent: its status, its turns, compacting, quitting, its transcript, its usage.
export class Status {
  // When each working session's transcript was last read for the end of its turn.
  private readonly turnLooks = new Map<string, number>();
  // When each session last went to work: an end the transcript recorded before then is an earlier turn's.
  private readonly workSince = new Map<string, number>();
  // While compacting: the status it came from, and whether its spinner has been seen on screen.
  private readonly compactions = new Map<string, { before: ClaudeStatus; seen: boolean }>();

  constructor(
    private readonly s: MachineState,
    private readonly d: MachineDeps,
    private readonly p: Parts,
  ) {}

  // A status an agent reported, told as a hook's would be.
  moved(id: string, status: ClaudeStatus, said: string): void {
    const meta = this.d.store.get().sessions[id];
    const prev = this.getStatus(id);
    if (!meta || prev === status) return;
    this.setStatus(id, status);
    // What it asked on screen before its thread started is gone once the thread says how it is.
    void this.p.input.onScreen(id).catch(() => {});
    const n = notificationFor(prev, status, shownTitle(meta));
    if (n && this.s.notifier) void this.s.notifier.notify(id, n.title, n.event, said).catch(() => {});
  }

  // A new process knows no statuses: what the screen shows stands in until a hook says otherwise, and a
  // hook that comes while the screen is being read wins.
  private readonly filling = new Map<string, Promise<void>>();
  fillStatus(id: string): Promise<void> {
    if (this.s.statuses.has(id)) return Promise.resolve();
    const reading = this.filling.get(id) ?? this.readStatus(id).finally(() => this.filling.delete(id));
    this.filling.set(id, reading);
    return reading;
  }
  private async readStatus(id: string): Promise<void> {
    try {
      const { choices, panel } = await this.p.input.onScreen(id);
      // Between calls Claude shows its prompt as it does when done: the transcript says which.
      const going = !choices && !panel && (await this.turn(id))?.over === false;
      if (!this.s.statuses.has(id)) this.setStatus(id, choices || panel ? 'waiting' : going ? 'working' : 'idle');
    } catch {
      // gone meanwhile; the next listing drops it
    }
  }

  // A Claude session whose Claude no longer runs, however it ended, has ended; one marked ended whose Claude runs
  // is read again from its screen.
  async followClaudes(panes: { id: string; panePid: number }[]): Promise<void> {
    const running = await agentsRunning(panes.map((p) => p.panePid));
    if (!running) return;
    for (const { id, panePid } of panes) {
      // One being gone on with is looked at once its Claude was started.
      const sid = this.d.store.get().sessions[id]?.claudeSessionId;
      if (sid && this.s.resuming.has(sid)) continue;
      if (!running.get(panePid)) this.claudeQuit(id);
      else if (this.s.statuses.get(id) === 'ended') this.s.statuses.delete(id);
    }
  }

  claudeQuit(id: string): void {
    if (this.s.statuses.get(id) === 'ended') return;
    this.d.asks.endAll(id);
    this.d.journal.screenAsIs(id, NOTHING_SHOWN);
    this.setStatus(id, 'ended');
  }

  // Whether what is typed into a session goes to its agent rather than the shell an ended Claude left; when it
  // cannot be looked at, it is taken as running.
  async agentRuns(id: string): Promise<boolean> {
    if (this.d.store.get().sessions[id]?.kind !== 'claude') return true;
    const pane = await this.d.tmux.panePid(tmuxName(id)).catch(() => undefined);
    const runs = pane === undefined ? undefined : (await agentsRunning([pane]))?.get(pane);
    if (runs === false) this.claudeQuit(id);
    return runs !== false;
  }

  // Told Claude is ending (SessionEnd comes on /clear too), its process is looked at until it is gone, for a few
  // seconds; the listing would see it within one. One quit to be started again is not.
  claudeMayHaveQuit(id: string): void {
    const sid = this.d.store.get().sessions[id]?.claudeSessionId;
    if (sid && this.s.resuming.has(sid)) return;
    let looks = 15;
    const look = async () => {
      if ((await this.agentRuns(id)) && --looks > 0) this.s.later(200, () => void look().catch(() => {}));
    };
    void look().catch(() => {});
  }

  setStatus(id: string, status: ClaudeStatus): void {
    if (status !== 'waiting') this.s.screenWaits.delete(id);
    if (status !== 'compacting') this.compactions.delete(id);
    if (this.s.statuses.get(id) === status) return;
    if (status === 'working') this.workSince.set(id, Date.now());
    this.s.statuses.set(id, status);
    this.d.journal.status(id, status);
    this.s.emit();
    if (this.d.outbox.list(id).length) void this.d.outbox.flush(id);
    if (status === 'idle') void this.p.moves.turnOver(id);
  }

  // What each listing checks of a Claude session: its status when not known, whether a compaction is still
  // on screen, and whether what waits for it can go.
  look(id: string): void {
    void this.fillStatus(id);
    this.watchTranscript(id);
    // A choice or dialog no hook reports (trust this folder? before it starts, /model at the prompt) is a
    // wait read off the screen, and it is over when the screen no longer shows it.
    const st = this.s.statuses.get(id);
    if (st === 'starting' || st === 'idle' || this.s.screenWaits.has(id)) {
      void this.p.input.onScreen(id)
        .then(({ choices, panel }) => (choices || panel ? this.p.input.waitOnScreen(id) : this.p.input.waitOnScreenOver(id)))
        .catch(() => {});
    }
    if (this.s.statuses.get(id) === 'compacting') void this.p.input.onScreen(id).catch(() => {});
    if (this.s.statuses.get(id) === 'working') void this.endTurnHooksMissed(id);
    // Until its status is known, nothing goes to it: it may be at work.
    if (this.s.statuses.has(id) && this.d.outbox.list(id).length) void this.d.outbox.flush(id);
  }

  // A Codex session's thread is followed (again, after a restart), and what waits for it goes once it can.
  lookCodex(id: string, meta: SessionMeta): void {
    this.d.codex?.follow(id, meta.codexThreadId);
    // One with no thread yet, as this server finds it after a restart, has not started.
    if (!meta.codexThreadId && !this.s.statuses.has(id)) this.setStatus(id, 'starting');
    if (this.p.input.beforeThread(id))
      void this.p.input.onScreen(id)
        .then(({ choices }) => (choices && this.p.input.beforeThread(id) ? this.p.input.waitOnScreen(id) : this.p.input.waitOnScreenOver(id)))
        .catch(() => {});
    if (this.s.statuses.has(id) && this.d.outbox.list(id).length) void this.d.outbox.flush(id);
  }

  // What Claude Code's transcript says of the turn a session is on; null when there is none to read.
  private async turn(id: string): Promise<ReturnType<typeof turnInTranscript>> {
    const sid = this.d.store.get().sessions[id]?.claudeSessionId;
    if (!this.d.claudeProjectsRoot || !sid) return null;
    const path = await findTranscript(this.d.claudeProjectsRoot, sid).catch(() => null);
    return path ? turnInTranscript(path) : null;
  }

  // A turn can end with no hook to say so (Esc typed at the Mac, a hook Claude did not send): once the
  // transcript has said for a while that it is over, so is the work, and what waits can go.
  private async endTurnHooksMissed(id: string): Promise<void> {
    const now = Date.now();
    if (now - (this.turnLooks.get(id) ?? 0) < TURN_LOOK_MS) return;
    this.turnLooks.set(id, now);
    const turn = await this.turn(id);
    const ended = turn?.over && turn.at >= (this.workSince.get(id) ?? 0);
    if (ended && Date.now() - turn.at >= TURN_OVER_AFTER_MS && this.s.statuses.get(id) === 'working') this.setStatus(id, 'idle');
  }

  private watchTranscript(id: string): void {
    if (!this.d.claudeProjectsRoot || this.s.transcriptWatches.has(id)) return;
    const stop = watchTranscript(this.d.claudeProjectsRoot, () => this.d.store.get().sessions[id]?.claudeSessionId, () => void this.p.sessions.ingest(id));
    this.s.transcriptWatches.set(id, stop);
  }

  // A session gone from tmux: nothing of it runs to follow. Its rows stay while it is kept as past.
  forget(id: string): void {
    this.s.transcriptWatches.get(id)?.();
    this.s.transcriptWatches.delete(id);
    this.s.statuses.delete(id);
    this.workSince.delete(id);
    this.turnLooks.delete(id);
    this.compactions.delete(id);
    this.s.screenWaits.delete(id);
    this.s.usages.delete(id);
    this.d.asks.endAll(id);
    this.d.codex?.forget(id);
    this.s.macLooks.delete(id);
  }

  compactStarted(id: string): void {
    if (this.compactions.has(id)) return;
    const before = this.s.statuses.get(id) ?? 'idle';
    this.setStatus(id, 'compacting');
    this.compactions.set(id, { before, seen: false });
  }

  // One asked for with /compact ends at the prompt; one Claude made on its own goes back to what it was doing.
  compactEnded(id: string, manual: boolean): void {
    const c = this.compactions.get(id);
    if (c) this.setStatus(id, manual ? 'idle' : c.before);
  }

  // The screen ends only a compaction whose spinner it has shown: a spinner it cannot make out says nothing.
  compactingOnScreen(id: string, shown: boolean): void {
    if (shown) {
      this.compactStarted(id);
      this.compactions.get(id)!.seen = true;
    } else if (this.compactions.get(id)?.seen) {
      this.compactEnded(id, false);
    }
  }

  setUsage(id: string, usage: Usage | null): void {
    if (!usage || !this.d.store.get().sessions[id]) return;
    if (JSON.stringify(this.s.usages.get(id)) === JSON.stringify(usage)) return;
    this.s.usages.set(id, usage);
    const meta = this.d.store.get().sessions[id];
    if (meta.kind === 'claude' && meta.claudeDir !== undefined && (usage.fiveHour || usage.sevenDay)) this.p.accounts.keepLimits(meta.claudeDir, usage);
    this.s.emit();
  }

  getStatus(id: string): ClaudeStatus | null {
    return this.s.statuses.get(id) ?? null;
  }

  // The Claude session running in a workoffdesk session, as its hooks report it.
  setClaudeSessionId(id: string, claudeSessionId: string): void {
    if (!UUID.test(claudeSessionId)) return;
    const meta = this.d.store.get().sessions[id];
    if (!meta || meta.claudeSessionId === claudeSessionId) return;
    this.d.store.update((st) => {
      const name = meta.claudeSessionId && st.claudeNames[meta.claudeSessionId];
      if (name) nameConversation(st, claudeSessionId, name);
      st.sessions[id].claudeSessionId = claudeSessionId;
    });
    void this.p.sessions.ingest(id);
    this.s.emit();
  }
}
