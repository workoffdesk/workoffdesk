import type { MessageState } from '../../journal/index.js';
import { isDir } from '../../system/dirs.js';
import { Conflict, NotFound } from '../../system/errors.js';
import { m } from '../../system/messages.js';
import type { SessionMeta } from '../../system/store.js';
import type { MachineDeps, MachineState, Parts } from './state.js';
import type { MoveWhen, TermSession } from './types.js';

// A message Claude may not have taken in yet: waiting to go, being pasted, or held in Claude's own queue.
const NOT_TAKEN_IN: ReadonlySet<MessageState> = new Set(['queued', 'delivering', 'enqueued']);
// How often a session to move is looked at again while a Claude on the Mac holding its conversation is at work.
const MAC_LOOK_MS = 3000;

// Open Claude sessions moved to the account in use, each between its turns.
export class Moves {
  private readonly lookingAgain = new Set<string>();

  constructor(
    private readonly s: MachineState,
    private readonly d: MachineDeps,
    private readonly p: Parts,
  ) {}

  // Its Claude idle, and all it was sent taken in.
  private betweenTurns(id: string): boolean {
    return this.s.statuses.get(id) === 'idle' && !this.d.journal.messages(id).some((q) => NOT_TAKEN_IN.has(q.state));
  }

  // A Claude session here whose Claude runs, in a folder still there to start it again in.
  private movable(id: string, meta: SessionMeta): boolean {
    return meta.kind === 'claude' && !!meta.claudeSessionId && this.s.statuses.get(id) !== 'ended' && isDir(meta.cwd);
  }

  // One movable, started here rather than from a terminal, on another account than inUse.
  private onAnother(id: string, meta: SessionMeta, inUse: string): boolean {
    return this.movable(id, meta) && !meta.terminal && meta.claudeDir !== inUse;
  }

  // Those on another account, and of them those to move once their turn is over; none before an account is picked.
  counts(inUse: string | undefined): { elsewhere: number; moving: number } {
    const counts = { elsewhere: 0, moving: 0 };
    if (inUse === undefined) return counts;
    for (const [id, meta] of Object.entries(this.d.store.get().sessions)) {
      if (this.onAnother(id, meta, inUse)) counts[meta.moving ? 'moving' : 'elsewhere']++;
    }
    return counts;
  }

  // Each session on another account moves when its turn is over; one at its prompt now, at once.
  async moveAll(): Promise<void> {
    const inUse = await this.p.accounts.accountInUse();
    if (inUse === undefined) throw new Conflict('no Claude account was picked yet', 'account-none-picked');
    const ids = Object.entries(this.d.store.get().sessions).flatMap(([id, meta]) => (this.onAnother(id, meta, inUse) ? [id] : []));
    if (!ids.length) return;
    this.d.store.update((st) => {
      for (const id of ids) if (st.sessions[id]) st.sessions[id].moving = true;
    });
    this.s.emit();
    for (const id of ids) void this.turnOver(id);
  }

  // Told a session is at its prompt: one to move moves now, unless what was sent to it may not be taken in yet or a
  // Claude on the Mac holding its conversation is at work, and stays marked until it has moved or failed to. The
  // idle Claudes there are quit first. One no longer on another account (its account picked again, or gone on with
  // after its Claude quit) is not moved.
  async turnOver(id: string): Promise<void> {
    if (!this.d.store.get().sessions[id]?.moving) return;
    const inUse = await this.p.accounts.accountInUse();
    const meta = this.d.store.get().sessions[id];
    if (!meta?.moving) return;
    if (inUse === undefined || !this.movable(id, meta) || meta.claudeDir === inUse) return this.unmark(id);
    if (!this.betweenTurns(id)) return;
    try {
      await this.p.lifecycle.moveClaude(id);
    } catch (e) {
      if (e instanceof Conflict && e.code === 'open-on-mac-busy') return this.lookAgain(id);
      console.error(`workoffdesk: session ${id} could not be moved to the Claude account in use: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.unmark(id);
  }

  // The one session asked for, one started from a terminal too, any Claude in a terminal on the Mac holding its
  // conversation quit first. With no when, moved now if nothing is at work, else refused saying why; now, moved whatever
  // is at work; free, marked to move once it is free (turnOver). Answered once it runs on the account in use, or marked.
  async moveThis(id: string, when?: MoveWhen): Promise<TermSession> {
    const inUse = await this.p.accounts.accountInUse();
    if (inUse === undefined) throw new Conflict('no Claude account was picked yet', 'account-none-picked');
    const meta = this.d.store.get().sessions[id];
    if (!meta) throw new NotFound('no such session');
    if (!this.movable(id, meta)) throw new Conflict(m.moveThis.cannot, 'cannot-move');
    if (meta.claudeDir === inUse) return this.p.sessions.toSession(id, meta, Date.now());
    if (when === 'free') {
      this.d.store.update((st) => void (st.sessions[id] && (st.sessions[id].moving = true)));
      this.s.emit();
      void this.turnOver(id);
      return this.p.sessions.toSession(id, this.d.store.get().sessions[id] ?? meta, Date.now());
    }
    if (when !== 'now' && !this.betweenTurns(id)) throw new Conflict(m.moveThis.busy, 'session-busy');
    return this.p.lifecycle.moveClaude(id, when === 'now').catch((e: unknown) => {
      throw e instanceof Conflict ? e : new Conflict(m.moveThis.failed(e instanceof Error ? e.message : String(e)), 'move-failed');
    });
  }

  private lookAgain(id: string): void {
    if (this.lookingAgain.has(id)) return;
    this.lookingAgain.add(id);
    setTimeout(() => {
      this.lookingAgain.delete(id);
      void this.turnOver(id);
    }, MAC_LOOK_MS).unref();
  }

  private unmark(id: string): void {
    this.d.store.update((st) => void (st.sessions[id] && delete st.sessions[id].moving));
    this.s.emit();
  }
}
