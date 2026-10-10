import { t } from '@workoffdesk/i18n';
import { describe, expect, it } from 'vitest';
import { MODES, modeName, stepToMode } from '../../src/composer/modes';

// A Claude prompt whose mode moves one step along Shift+Tab's round each press, showing the change after
// `lag` reads of the screen.
function claude(start: string | null, lag = 0) {
  const round = MODES.map((m) => m.mode);
  let at = round.indexOf(start);
  let shownIn = 0;
  const presses: number[] = [];
  return {
    presses,
    modeNow: async () => {
      if (shownIn > 0) shownIn--;
      return shownIn > 0 ? round[(at - 1 + round.length) % round.length] : round[at];
    },
    press: () => {
      presses.push(at);
      at = (at + 1) % round.length;
      shownIn = lag;
      return true;
    },
    sleep: async () => {},
  };
}

describe('MODES and modeName', () => {
  it('go round in the order Shift+Tab takes them, the unnamed default first', () => {
    expect(MODES.map((m) => m.mode)).toEqual([null, 'accept edits', 'plan mode', 'auto mode', 'bypass permissions']);
  });

  it("name a mode in the phone's language, and an unknown one as Claude shows it", () => {
    expect(modeName(null)).toBe(t.modes.default);
    expect(modeName('plan mode')).toBe(t.modes['plan mode']);
    expect(modeName('something new')).toBe('something new');
  });
});

describe('stepToMode', () => {
  it('presses until the screen shows the mode asked for, and no further', async () => {
    const c = claude(null);
    expect(await stepToMode('plan mode', c)).toBe('plan mode');
    expect(c.presses).toHaveLength(2);
  });

  it('waits for a slow screen to show each press before pressing again', async () => {
    const c = claude(null, 3);
    expect(await stepToMode('auto mode', c)).toBe('auto mode');
    expect(c.presses).toHaveLength(3);
  });

  it('does not press when the mode is already the one asked for', async () => {
    const c = claude('accept edits');
    expect(await stepToMode('accept edits', c)).toBe('accept edits');
    expect(c.presses).toHaveLength(0);
  });

  it('goes round past the end back to the default', async () => {
    const c = claude('bypass permissions');
    expect(await stepToMode(null, c)).toBe(null);
    expect(c.presses).toHaveLength(1);
  });

  it('stops after one round and a step when the mode never comes, and says which it is', async () => {
    const c = { ...claude(null), modeNow: async () => 'accept edits' as string | null };
    const got = await stepToMode('plan mode', { ...c, press: () => (c.presses.push(0), true) });
    expect(got).toBe('accept edits');
    expect(c.presses.length).toBeLessThanOrEqual(MODES.length + 1);
  });

  it('stops at once when a press fails', async () => {
    const c = claude(null);
    let n = 0;
    expect(await stepToMode('plan mode', { ...c, press: () => (n++, false) })).toBe(null);
    expect(n).toBe(1);
  });
});
