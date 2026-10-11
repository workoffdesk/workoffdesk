import type { MacOpen } from '../../agents/claude/terminals.js';
import { InvalidRequest } from '../../system/errors.js';
import type { MachineDeps, MachineState, Parts } from './state.js';
import type { ConversationResume, CreateSpec, TermSession } from './types.js';

// How often a conversation waited on is looked at on the Mac, and for how long at most.
const TAKE_OVER_LOOK_MS = 2_000;
const TAKE_OVER_WAIT_MS = 12 * 3600_000;
// The step a take-over waits for is done once the conversation is open nowhere, or its turn is over there.
const stepDone = (s: MacOpen['status'] | undefined) => !s || s === 'idle' || s === 'background';

// Conversations open in a terminal on the Mac, to be taken over once the step there is done. Each is kept in the
// store while it is waited on, so a server started again goes on waiting for it.
export class TakeOvers {
  // Per conversation waited on, the way to stop waiting.
  private readonly waits = new Map<string, () => void>();

  constructor(
    private readonly s: MachineState,
    private readonly d: MachineDeps,
    private readonly p: Parts,
  ) {}

  // Those the store has, waited on again; one waited on past its time is let go.
  resume(): void {
    for (const [sid, w] of Object.entries(this.d.store.get().takeOvers ?? {})) {
      if (Date.now() > w.until) this.forget(sid);
      else this.wait({ kind: w.kind, cwd: w.cwd, resumeId: sid, title: w.title }, w.until);
    }
  }

  async whenIdle(spec: ConversationResume): Promise<TermSession | null> {
    if (this.waits.has(spec.resumeId)) return null;
    if (stepDone(await this.onMacStatus(spec))) return this.p.lifecycle.createSession(takenOver(spec));
    const until = Date.now() + TAKE_OVER_WAIT_MS;
    this.d.store.update((st) => {
      st.takeOvers = { ...st.takeOvers, [spec.resumeId]: { kind: spec.kind, cwd: spec.cwd, title: spec.title, until } };
    });
    this.wait(spec, until);
    return null;
  }

  waiting(sid: string): boolean {
    return this.waits.has(sid);
  }

  cancel(sid: string): boolean {
    const done = this.waits.get(sid);
    done?.();
    return !!done;
  }

  private wait(spec: ConversationResume, until: number): void {
    const sid = spec.resumeId;
    let stop: () => void;
    const done = () => {
      stop();
      this.waits.delete(sid);
      this.forget(sid);
      this.s.emit();
    };
    const look = async () => {
      const now = await this.onMacStatus(spec).catch(() => 'busy' as const);
      if (this.waits.get(sid) !== done) return;
      if (!stepDone(now)) {
        if (Date.now() > until) return done();
        stop = this.s.later(TAKE_OVER_LOOK_MS, () => void look());
        return;
      }
      done();
      await this.p.lifecycle.createSession(takenOver(spec)).catch((e) =>
        console.error(`workoffdesk: conversation ${sid} could not be taken over from the Mac: ${e instanceof Error ? e.message : String(e)}`),
      );
    };
    this.waits.set(sid, done);
    stop = this.s.later(TAKE_OVER_LOOK_MS, () => void look());
    this.s.emit();
  }

  private forget(sid: string): void {
    if (!this.d.store.get().takeOvers?.[sid]) return;
    this.d.store.update((st) => {
      delete st.takeOvers?.[sid];
    });
  }

  // What a conversation is doing in a terminal on the Mac: undefined when it is open in none.
  private async onMacStatus(spec: ConversationResume): Promise<MacOpen['status'] | undefined> {
    if (spec.kind === 'claude') return (await this.p.lifecycle.openOnMac()).get(spec.resumeId)?.status;
    if (!this.d.codexThreads) throw new InvalidRequest('Codex is not set up on this Mac');
    const t = await this.d.codexThreads.where(spec.resumeId);
    return t?.holder?.at === 'terminal' ? (t.busy ? 'busy' : 'idle') : undefined;
  }
}

const takenOver = (spec: ConversationResume): CreateSpec =>
  spec.kind === 'claude' ? { ...spec, kind: 'claude', takeOver: true } : { ...spec, kind: 'codex', takeOver: true };
