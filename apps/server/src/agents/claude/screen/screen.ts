import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Tmux } from '../../../system/tmux.js';
import { keysToChoose, keysToTick, parseChoices, type Choices } from './choices.js';
import { isCompacting } from './compacting.js';
import { liveText } from './live.js';
import { parsePanel, type Panel } from './panel.js';
import { modeOn, suggestionOn } from './prompt.js';

// What the session's screen holds for the chat: a choice asked for, a dialog open over the prompt, what
// Claude suggests saying next, and the permission mode.
// live: what Claude is writing and the transcript does not have yet, while it works.
export type ScreenRead = { choices: Choices | null; panel: Panel | null; suggestion: string | null; mode: string | null; live: string | null };

// How far above the screen to look for the top edge of a dialog taller than it.
const PANEL_ABOVE = 200;
// How much of a plan file is sent to be read on the phone.
const PLAN_MAX = 20_000;

// Claude Code's TUI in a tmux session, as read off its screen and answered by keys. Sessions are tmux
// session names.
export class ClaudeScreen {
  constructor(
    private readonly tmux: Tmux,
    // The width Claude's lines are taken to wrap at when the window's own cannot be read.
    private readonly cols: number,
  ) {}

  // working: Claude is at work, so the text it is writing is read too. compacting: its spinner shows.
  async read(name: string, working: boolean): Promise<{ screen: ScreenRead; compacting: boolean }> {
    const [{ screen, above }, styled, joined, cols] = await Promise.all([
      this.tmux.screenAndAbove(name, PANEL_ABOVE),
      this.tmux.screenStyled(name).catch(() => ''),
      working ? this.tmux.screenJoined(name).catch(() => '') : Promise.resolve(''),
      working ? this.tmux.windowSize(name).then((s) => s.cols, () => this.cols) : Promise.resolve(this.cols),
    ]);
    const choices = withPlan(parseChoices(screen));
    const panel = parsePanel(screen, above);
    const live = working && !choices && !panel ? liveText(joined, cols) : null;
    return { screen: { choices, panel, suggestion: suggestionOn(styled), mode: modeOn(screen), live }, compacting: isCompacting(screen) };
  }

  async choices(name: string, parse = parseChoices): Promise<Choices | null> {
    return parse(await this.tmux.screen(name));
  }

  // Takes option `index` if it is still `label` on screen; false when the screen has moved on. parse: how
  // the screen's choices are read, for a TUI other than Claude Code's drawn the same way. text: an answer of
  // one's own, for the option that is a field for one, typed into it and taken.
  async choose(name: string, index: number, label: string, parse = parseChoices, text?: string): Promise<boolean> {
    const c = await this.choices(name, parse);
    if (!c || c.options[index]?.label !== label) return false;
    if (text !== undefined && !c.options[index].typed) return false;
    await this.tmux.leaveCopyMode(name);
    await this.tmux.sendRaw(name, keysToChoose(c, index));
    if (text !== undefined) await this.tmux.paste(name, text);
    return true;
  }

  // Sends a question that takes several answers with the options at `ticked` ticked, if it is still the
  // one whose options were `labels`.
  async tick(name: string, ticked: number[], labels: string[]): Promise<boolean> {
    const c = await this.choices(name);
    if (!c?.submit || c.options.length !== labels.length || c.options.some((o, i) => o.label !== labels[i])) return false;
    if (ticked.some((i) => i >= c.options.length || c.options[i].typed)) return false;
    await this.tmux.leaveCopyMode(name);
    await this.tmux.sendRaw(name, keysToTick(c, ticked));
    return true;
  }
}

// A choice to go ahead with a plan, with the plan it names read from Claude Code's plans folder; the name
// is a bare file name, so nothing outside that folder is read.
function withPlan(c: Choices | null): Choices | null {
  if (!c?.planFile) return c;
  try {
    return { ...c, plan: readFileSync(join(homedir(), '.claude', 'plans', basename(c.planFile)), 'utf8').slice(0, PLAN_MAX) };
  } catch {
    return c;
  }
}
