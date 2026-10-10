import { t } from '@workoffdesk/i18n';

// The permission modes Shift+Tab goes through, as the line under Claude's prompt names them; null is the
// default, which it does not name.
export const MODES: { mode: string | null; name: string }[] = [
  { mode: null, name: t.modes.default },
  { mode: 'accept edits', name: t.modes['accept edits'] },
  { mode: 'plan mode', name: t.modes['plan mode'] },
  { mode: 'auto mode', name: t.modes['auto mode'] },
  { mode: 'bypass permissions', name: t.modes['bypass permissions'] },
];

export const modeName = (mode: string | null) => MODES.find((m) => m.mode === mode)?.name ?? mode ?? '';

export const SHIFT_TAB = '\x1b[Z';
// Shift+Tab goes round all five modes and one more; each press is given this long to show, read this often.
// A press and the screen that shows it each cross the line from the phone, which takes seconds.
const MODE_PRESSES = MODES.length + 1;
const MODE_WAIT_MS = 5000;
const MODE_POLL_MS = 150;

// Steps through the permission modes until the screen shows `want`; after each press the screen is read
// until the mode on it changes, so a slow screen is not pressed past, and the next press is decided from what
// it shows. Says the mode it ended on (undefined when the screen could not be read).
export async function stepToMode(
  want: string | null,
  o: { modeNow: () => Promise<string | null | undefined>; press: () => boolean; sleep: (ms: number) => Promise<void> },
): Promise<string | null | undefined> {
  let mode = await o.modeNow();
  for (let i = 0; i < MODE_PRESSES && mode !== want; i++) {
    if (!o.press()) return mode;
    const before = mode;
    for (let waited = 0; waited < MODE_WAIT_MS && mode === before; waited += MODE_POLL_MS) {
      await o.sleep(MODE_POLL_MS);
      mode = await o.modeNow();
    }
  }
  return mode;
}
