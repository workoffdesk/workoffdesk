import type { Panel } from '../model/chat';

const RIGHT = '\x1b[C';
const LEFT = '\x1b[D';
const UP = '\x1b[A';
const DOWN = '\x1b[B';
// A /btw answer longer than this may run past the screen, which shows it a part at a time.
const BTW_SCROLLS = 10;
const BTW_STEP = 10;

// What a card for one of Claude Code's panels types into it. The slider moves a step per arrow; s takes the
// level for this session only, as a model picked here is.
export function effortKeys(effort: NonNullable<Panel['effort']>, to: number): string {
  const step = to > effort.at ? RIGHT : LEFT;
  return step.repeat(Math.abs(to - effort.at)) + 's';
}

export const scrollsInParts = (panel: Panel) => !!panel.btw && panel.body.split('\n').length >= BTW_SCROLLS;
export const SCROLL_UP = UP.repeat(BTW_STEP);
export const SCROLL_DOWN = DOWN.repeat(BTW_STEP);
