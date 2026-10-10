import { tmuxName } from '../sessionName.js';
import type { MachineDeps, MachineState, Parts } from './state.js';

// How often the names on their way are looked at, and how long one typed waits for Claude to take it before it
// is typed again.
const CHECK_MS = 2_000;
const TYPED_AGAIN_MS = 30_000;

// A name given a session here, given to its agent too (SessionMeta.naming): Codex sets it on the thread; a
// Claude that runs is typed /rename when its prompt is free, and one that does not is started with --name.
export class Naming {
  private readonly typedAt = new Map<string, number>();
  private run: Promise<void> | null = null;
  private again = false;
  private cancel: (() => void) | null = null;

  constructor(
    private readonly s: MachineState,
    private readonly d: MachineDeps,
    private readonly p: Parts,
  ) {}

  // Gives each name on its way now, and again every CHECK_MS while any is.
  watch(): void {
    if (this.run) {
      this.again = true;
      return;
    }
    this.cancel?.();
    this.cancel = null;
    this.run = this.giveAll().finally(() => {
      this.run = null;
      if (this.again) {
        this.again = false;
        this.watch();
      } else if (this.onTheirWay().length) this.cancel = this.s.later(CHECK_MS, () => this.watch());
    });
  }

  // The agent took the name, or was started with it.
  taken(id: string): void {
    this.typedAt.delete(id);
  }

  private onTheirWay(): string[] {
    return Object.entries(this.d.store.get().sessions).flatMap(([id, meta]) => (meta.naming ? [id] : []));
  }

  private async giveAll(): Promise<void> {
    for (const id of this.onTheirWay()) await this.give(id).catch(() => {});
  }

  private async give(id: string): Promise<void> {
    const meta = this.d.store.get().sessions[id];
    const name = meta?.naming;
    if (!name) return;
    if (meta.kind === 'codex') {
      if (!meta.codexThreadId || !this.d.codex) return;
      await this.d.codex.rename(meta.codexThreadId, name);
      return this.clear(id, name);
    }
    if (meta.kind !== 'claude') return this.clear(id, name);
    const typed = this.typedAt.get(id);
    if (typed !== undefined && Date.now() - typed < TYPED_AGAIN_MS) return;
    // One that ended is started again with --name.
    if (this.s.statuses.get(id) === 'ended') return;
    // Typed over a dialog it would go into it; after half a message, it would send that.
    if (!(await this.p.status.agentRuns(id)) || (await this.p.input.dialogOpen(id))) return;
    if (await this.d.claude.typed(tmuxName(id))) return;
    await this.d.tmux.leaveCopyMode(tmuxName(id));
    await this.d.tmux.sendRaw(tmuxName(id), `/rename ${name}\r`);
    this.typedAt.set(id, Date.now());
  }

  private clear(id: string, name: string): void {
    this.d.store.update((st) => {
      const now = st.sessions[id];
      if (now?.naming === name) delete now.naming;
    });
  }
}
