import type { HeldHook, PermissionPayload } from '../../agents/claude/hooks/asks.js';
import type { Choices } from '../../agents/claude/screen/choices.js';
import { codexChoices } from '../../agents/codex/screen.js';
import type { Answer } from '../../agents/types.js';
import { InvalidRequest } from '../../system/errors.js';
import { tmuxName } from '../sessionName.js';
import { CHAT_SIZE, ID, type MachineDeps, type MachineState, type Parts } from './state.js';
import { SCREEN_HISTORY, type OnScreen } from './types.js';

// What a message keeps of the control characters: line breaks and tabs. The rest would be keys.
const CONTROL = /(?![\n\t])\p{Cc}/gu;
// How long a command is given to show the dialog it opens, read this often; one that opens none is over
// once that time has passed.
const COMMAND_SHOWS_MS = 1500;
const COMMAND_LOOK_MS = 100;
// A dialog takes an Esc for each thing it has open in it (/config's search box, then itself).
const CLOSE_ESCS = 3;
// How often, while a session's page is looked at, the Mac is looked at for its conversation open there too.
const MAC_LOOK_MS = 10_000;

// What is on a session's screen, and acting on it: choices, answers, keys, commands, what is pasted.
export class Input {
  // Per session, the last command until what it opened shows.
  private readonly commands = new Map<string, Promise<unknown>>();

  constructor(
    private readonly s: MachineState,
    private readonly d: MachineDeps,
    private readonly p: Parts,
  ) {}

  async choices(id: string): Promise<Choices | null> {
    if (!ID.test(id)) throw new InvalidRequest('bad session id');
    return this.d.claude.choices(tmuxName(id));
  }

  async onScreen(id: string): Promise<OnScreen> {
    if (!ID.test(id)) throw new InvalidRequest('bad session id');
    // Codex's screen is not Claude's: what it waits on comes from its app server, but for what it asks
    // before its thread starts (trust this folder?).
    if (this.d.store.get().sessions[id]?.kind === 'codex') {
      const choices = this.beforeThread(id) ? codexChoices(await this.d.tmux.screen(tmuxName(id))) : null;
      const screen = { choices, panel: null, suggestion: null, mode: null };
      this.d.journal.screenAsIs(id, screen);
      return { ...screen, live: null, asks: this.d.codex?.asks(id) ?? [] };
    }
    if (Date.now() - (this.s.macLooks.get(id) ?? 0) >= MAC_LOOK_MS) {
      this.s.macLooks.set(id, Date.now());
      this.p.lifecycle.openOnMac().catch(() => {});
    }
    const { screen, compacting } = await this.d.claude.read(tmuxName(id), this.s.statuses.get(id) === 'working');
    this.p.status.compactingOnScreen(id, compacting);
    this.d.journal.screen(id, screen);
    return { ...screen, asks: this.d.asks.list(id) };
  }

  async screenText(id: string): Promise<string> {
    if (!ID.test(id)) throw new InvalidRequest('bad session id');
    return (await this.d.tmux.screenWithHistory(tmuxName(id), SCREEN_HISTORY)).trimEnd();
  }

  async choose(id: string, index: number, label: string, text?: string): Promise<boolean> {
    if (!ID.test(id)) throw new InvalidRequest('bad session id');
    const pressed = await this.d.claude.choose(tmuxName(id), index, label, this.d.store.get().sessions[id]?.kind === 'codex' ? codexChoices : undefined, text);
    return this.readAfter(id, pressed, (s) => s.choices?.options[index]?.label !== label);
  }

  // Sends a question that takes several answers with the options at `ticked` ticked, if it is still the
  // one whose options were `labels`.
  async tick(id: string, ticked: number[], labels: string[]): Promise<boolean> {
    if (!ID.test(id)) throw new InvalidRequest('bad session id');
    const pressed = await this.d.claude.tick(tmuxName(id), ticked, labels);
    return this.readAfter(id, pressed, (s) => s.choices?.options.map((o) => o.label).join('\n') !== labels.join('\n'));
  }

  // The screen as it is once a choice was answered, or found changed, goes into the journal for the phone:
  // read now when nothing was pressed, else until the options pressed are gone.
  private readAfter(id: string, pressed: boolean, gone: (s: OnScreen) => boolean): boolean {
    void (pressed ? this.screenOnceShown(id, gone, () => null) : this.onScreen(id)).catch(() => {});
    return pressed;
  }

  // A prompt from a session's PermissionRequest hook, held for the phone; false when it is not one.
  holdPermission(id: string, payload: PermissionPayload, hook: HeldHook): boolean {
    if (!this.d.store.get().sessions[id]) {
      hook.reply(null);
      return false;
    }
    const ask = this.d.asks.hold(id, payload, hook);
    if (!ask) return false;
    hook.onGone(() => this.d.asks.gone(id, ask.id) && this.interrupted(id));
    this.s.emit();
    return true;
  }

  answer(id: string, askId: string, answer: Answer): boolean {
    if (this.d.store.get().sessions[id]?.kind === 'codex') return this.d.codex?.answer(id, askId, answer) ?? false;
    if (!this.d.asks.answer(id, askId, answer)) return false;
    if (!answer.allow) this.interrupted(id);
    this.s.emit();
    return true;
  }

  // A No to a permission prompt ends the turn, and no hook says so.
  private interrupted(id: string): void {
    if (this.s.statuses.get(id) === 'waiting' && !this.d.asks.list(id).length) this.p.status.setStatus(id, 'idle');
  }

  async type(id: string, text: string): Promise<void> {
    if (!ID.test(id)) throw new InvalidRequest('bad session id');
    // Esc stops Claude at work or turns down what it asked, and no hook says so; what waits can go. Over a
    // dialog of Claude Code's (/effort opened while Claude works), it only closes the dialog.
    const st = this.d.store.get().sessions[id]?.kind === 'claude' ? this.s.statuses.get(id) : undefined;
    const stops = text === '\x1b' && (st === 'waiting' || (st === 'working' && !(await this.onScreen(id).catch(() => null))?.panel));
    await this.d.tmux.leaveCopyMode(tmuxName(id));
    await this.d.tmux.sendRaw(tmuxName(id), text);
    if (stops) this.p.status.setStatus(id, 'idle');
  }

  async close(id: string): Promise<OnScreen> {
    let screen = await this.onScreen(id);
    for (let i = 0; i < CLOSE_ESCS && (screen.panel || screen.choices?.opened); i++) screen = await this.press(id, '\x1b');
    return screen;
  }

  async press(id: string, keys: string): Promise<OnScreen> {
    const before = JSON.stringify(await this.onScreen(id));
    await this.type(id, keys);
    return this.screenOnceShown(id, (s) => JSON.stringify(s) !== before, () => this.onScreen(id));
  }

  // A command waits for the one before it to show what it opened, so it does not go into that dialog, where
  // its Enter would take whatever the dialog has selected.
  async runCommand(id: string, command: string): Promise<{ ran: boolean; screen: OnScreen | null }> {
    if (!ID.test(id)) throw new InvalidRequest('bad session id');
    const run = (this.commands.get(id) ?? Promise.resolve()).then(() => this.typeCommand(id, command));
    // Given what it takes (`/effort high`), a command opens no dialog to wait for.
    const opens = !command.includes(' ');
    const shown: Promise<OnScreen | null> = run
      .then((ran) => (ran && opens ? this.commandShown(id) : null), () => null)
      .finally(() => this.commands.get(id) === shown && this.commands.delete(id));
    this.commands.set(id, shown);
    const ran = await run;
    return { ran, screen: ran ? await shown : null };
  }

  private async typeCommand(id: string, command: string): Promise<boolean> {
    if (!(await this.p.status.agentRuns(id)) || (await this.dialogOpen(id))) return false;
    await this.d.tmux.leaveCopyMode(tmuxName(id));
    await this.d.tmux.sendRaw(tmuxName(id), `${command}\r`);
    return true;
  }

  private commandShown(id: string): Promise<OnScreen | null> {
    return this.screenOnceShown(id, (s) => !!(s.choices || s.panel), () => null);
  }

  // The screen once `shown` holds for it, read every COMMAND_LOOK_MS; after COMMAND_SHOWS_MS, the last read,
  // or `none` when no read came back.
  private async screenOnceShown<T>(id: string, shown: (s: OnScreen) => boolean, none: () => Promise<T> | T): Promise<OnScreen | T> {
    let screen: OnScreen | null = null;
    for (let waited = 0; waited < COMMAND_SHOWS_MS; waited += COMMAND_LOOK_MS) {
      await new Promise((r) => setTimeout(r, COMMAND_LOOK_MS));
      screen = await this.onScreen(id).catch(() => screen);
      if (screen && shown(screen)) return screen;
    }
    return screen ?? none();
  }

  // Whether a choice or dialog of Claude's has the keyboard rather than its prompt: what is typed then goes
  // into the dialog, and Enter takes whatever it has selected. Seen here first, it is a wait like one
  // `look` finds.
  async dialogOpen(id: string): Promise<boolean> {
    if (this.d.store.get().sessions[id]?.kind !== 'claude') return false;
    const { choices, panel } = await this.onScreen(id);
    if (!choices && !panel) return false;
    this.waitOnScreen(id);
    return true;
  }

  waitOnScreen(id: string): void {
    const now = this.s.statuses.get(id);
    if (now !== 'starting' && now !== 'idle') return;
    this.p.status.setStatus(id, 'waiting');
    this.s.screenWaits.set(id, now);
  }

  waitOnScreenOver(id: string): void {
    const before = this.s.screenWaits.get(id);
    if (before === undefined || this.s.statuses.get(id) !== 'waiting') return;
    this.s.screenWaits.delete(id);
    this.p.status.setStatus(id, before === 'starting' ? 'starting' : 'idle');
  }

  // A Codex session whose TUI has not started its thread: it may be asking something on screen first.
  beforeThread(id: string): boolean {
    const meta = this.d.store.get().sessions[id];
    return meta?.kind === 'codex' && !meta.codexThreadId;
  }

  async paste(id: string, text: string): Promise<void> {
    await this.d.tmux.leaveCopyMode(tmuxName(id));
    await this.d.tmux.paste(tmuxName(id), text.replace(CONTROL, ''));
  }

  async fitForChat(id: string): Promise<void> {
    if (!ID.test(id)) throw new InvalidRequest('bad session id');
    const t = (await this.d.tmux.listSessions()).find((s) => s.name === tmuxName(id));
    if (t && !t.attached) await this.d.tmux.resizeWindow(tmuxName(id), CHAT_SIZE);
  }
}
