import type { ThemeChoice } from '@workoffdesk/client/settings/choices';
import { useMemo, useSyncExternalStore } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';
import { textSize, themeChoice } from './client';

// The web app's colours (apps/web/src/styles.css), dark and light: the phone's, or the one chosen in Settings.
const dark = {
  bg: '#0d1117',
  surface: '#161b22',
  surface2: '#1f2630',
  border: '#2d333b',
  text: '#e6edf3',
  muted: '#8b949e',
  accent: '#2f81f7',
  accentText: '#ffffff',
  danger: '#f85149',
  working: '#2f81f7',
  waiting: '#d29922',
  idle: '#3fb950',
  ended: '#6e7681',
  // A grey white reads on, for an action that is neither the main one nor destructive.
  neutral: '#6e7681',
  added: '#3fb950',
  addedBg: 'rgba(63, 185, 80, 0.16)',
  removedBg: 'rgba(248, 81, 73, 0.16)',
  // The logo's blue, in the light theme too.
  claude: '#2f81f7',
  codex: '#8957e5',
  shell: '#3d4450',
  needsYou: '#fa5151',
  // A row of the session list, one held down, and one pinned.
  row: '#161b22',
  rowHeld: '#1f2630',
  rowPinned: '#1a2028',
  // The bubble of what you sent.
  mine: '#2f81f7',
  mineText: '#ffffff',
  // What the bottom of the page turns to while the box is held, lightest at the top; white reads on the last.
  glow: ['#d6e8ff', '#5ea4ff', '#2f86ff', '#1670f5'] as readonly string[],
};

export type Colors = typeof dark;

const light: Colors = {
  ...dark,
  bg: '#f6f7f9',
  surface: '#ffffff',
  surface2: '#eef1f4',
  row: '#ffffff',
  rowHeld: '#eef1f4',
  rowPinned: '#f3f5f8',
  border: '#d8dee4',
  text: '#1f2328',
  muted: '#636c76',
  accent: '#0969da',
  mine: '#0969da',
  danger: '#cf222e',
  working: '#0969da',
  codex: '#8250df',
  waiting: '#bf8700',
  idle: '#1a7f37',
  ended: '#8c959f',
  neutral: '#636c76',
  added: '#1a7f37',
  addedBg: 'rgba(26, 127, 55, 0.12)',
  removedBg: 'rgba(207, 34, 46, 0.1)',
};

// Eye care: black on a soft green, after Superset's eye-care theme. The accent is terracotta, the warm that sits
// best with a grey green, quietened to C 0.10 (white on it 4.5:1, it on the green 3.8:1). What you sent is sand,
// the third colour of that pair (L 0.91 C 0.03 H 85; black on it 16:1): a pale terracotta reads pink on the green.
// The held box's glow runs from the sand to the accent, as the blue one does to the blue. The page is a soft
// green, Claude's replies Superset's eye-care terminal green (#B5E0BC) on it, the muted grey dark enough to read
// on either (4.6:1).
const eye: Colors = {
  ...light,
  bg: '#dff1df',
  surface: '#edf9ed',
  surface2: '#b5e0bc',
  // The list's rows about the green of Claude's replies, so they stand off the page.
  row: '#b5e0bc',
  rowHeld: '#a3d3ab',
  rowPinned: '#acdab4',
  border: '#aac7aa',
  text: '#000000',
  muted: '#505f50',
  accent: '#ad644e',
  // The avatars stay a sage: terracotta only in small places and the held box's glow.
  claude: '#87ae88',
  // Codex's a slate blue, the sage's cool counterpart at about its quietness (white on it 3.6:1).
  codex: '#7288a4',
  working: '#ad644e',
  mine: '#eae0cb',
  mineText: '#000000',
  // The blue glow's lightness at the terracotta's hue, quieter (white on the last 4.5:1).
  glow: ['#eae0cb', '#d88c74', '#bf745e', '#ad644e'],
  danger: '#e7000b',
  waiting: '#9c6900',
  ended: '#899989',
  neutral: '#505f50',
};

// A colour over transparency, as the stylesheet's color-mix(… n%, transparent).
export const tint = (hex: string, percent: number) =>
  hex +
  Math.round((percent / 100) * 255)
    .toString(16)
    .padStart(2, '0');

export const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

// The text size and the colours chosen in settings, for every screen at once.
const listeners = new Set<() => void>();
const changed = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

let size = textSize.get();
export function setTextSize(n: number) {
  size = n;
  textSize.keep(n);
  changed();
}

// The choice is set for the whole app as light or dark: iOS then draws its own parts (keyboard, alerts,
// status bar) to match, and useColorScheme below follows.
let chosen = themeChoice.get();
const applyTheme = (choice: ThemeChoice) =>
  Appearance.setColorScheme(choice === 'system' ? 'unspecified' : choice === 'eye' ? 'light' : choice);
applyTheme(chosen);
export function setTheme(choice: ThemeChoice) {
  chosen = choice;
  themeChoice.keep(choice);
  applyTheme(choice);
  changed();
}

export type Theme = { c: Colors; dark: boolean; size: number; fs: (px: number) => number };

// The colours for the phone's appearance, and fs: a designed font size at the chosen text size.
export function useTheme(): Theme {
  const scheme = useColorScheme();
  const n = useSyncExternalStore(subscribe, () => size);
  const choice = useSyncExternalStore(subscribe, () => chosen);
  return useMemo(() => {
    const isDark = choice !== 'eye' && scheme !== 'light';
    return { c: choice === 'eye' ? eye : isDark ? dark : light, dark: isDark, size: n, fs: (px: number) => Math.round(px * n) / 100 };
  }, [scheme, choice, n]);
}
