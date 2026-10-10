import { t } from '@workoffdesk/i18n';
import { describe, expect, it } from 'vitest';
import { pillFigure, resetIn, usageLines, usageText } from '../../src/mac/usage';

const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const inMinutes = (m: number) => (NOW + m * 60_000) / 1000;

describe('resetIn', () => {
  it.each([
    [0, t.resetsInMinutes(0)],
    [59, t.resetsInMinutes(59)],
    [60, t.resetsInHours(1, 0)],
    [125, t.resetsInHours(2, 5)],
    [24 * 60 + 61, t.resetsInDays(1, 1)],
  ])('says %i minutes ahead in the largest unit that fits', (m, said) => {
    expect(resetIn(inMinutes(m), NOW)).toBe(said);
  });

  it('says a time already past as now', () => {
    expect(resetIn(inMinutes(-30), NOW)).toBe(t.resetsInMinutes(0));
  });
});

describe('usageLines', () => {
  it('lists context, the limits with when they reset, the cost and the lines changed', () => {
    const lines = usageLines({ context: 42.4, fiveHour: { used: 10, resetsAt: inMinutes(90) }, sevenDay: { used: 85 }, cost: 1.5, added: 3, removed: 1 }, NOW);
    expect(lines).toEqual([
      { label: t.context, value: '42%', high: false },
      { label: t.fiveHourLimit, value: '10%', sub: t.resetsInHours(1, 30), high: false },
      { label: t.sevenDayLimit, value: '85%', sub: undefined, high: true },
      { label: t.sessionCost, value: '$1.50' },
      { label: t.linesChanged, value: t.lines(3, 1) },
    ]);
  });

  it('marks a figure from 80% on as running out', () => {
    expect(usageLines({ context: 79.4 }, NOW)[0].high).toBe(false);
    expect(usageLines({ context: 80 }, NOW)[0].high).toBe(true);
  });

  it('leaves out what the status line did not report', () => {
    expect(usageLines({}, NOW)).toEqual([]);
    expect(usageLines({ removed: 2 }, NOW)).toEqual([{ label: t.linesChanged, value: t.lines(0, 2) }]);
  });
});

describe('usageText', () => {
  it('gives the model and a line per figure, to copy', () => {
    const u = { model: 'Opus', context: 50, cost: 2 };
    expect(usageText(u, usageLines(u, NOW))).toBe(`Opus\n${t.context} 50%\n${t.sessionCost} $2.00`);
  });

  it('puts when a limit resets after it', () => {
    const u = { fiveHour: { used: 5, resetsAt: inMinutes(10) } };
    expect(usageText(u, usageLines(u, NOW))).toBe(`${t.fiveHourLimit} 5% (${t.resetsInMinutes(10)})`);
  });
});

describe('pillFigure', () => {
  it('shows the context, red only once the context itself is running out', () => {
    expect(pillFigure({ context: 42 })).toEqual({ label: t.contextLabel('42%'), accessibilityLabel: t.contextIs('42%'), high: false });
    expect(pillFigure({ context: 85 })).toMatchObject({ label: t.contextLabel('85%'), high: true });
  });

  it.each([
    ['5-hour', { fiveHour: { used: 91 } }, t.fiveHourLabel('91%'), t.limitIs(t.fiveHourLimit, '91%')],
    ['7-day', { sevenDay: { used: 80 } }, t.sevenDayLabel('80%'), t.limitIs(t.sevenDayLimit, '80%')],
  ])('shows a %s limit that is running out in red, in place of a context that is not', (_, limit, label, spoken) => {
    expect(pillFigure({ context: 42, ...limit })).toEqual({ label, accessibilityLabel: spoken, high: true });
  });

  it('keeps the context red when it runs out too, and ignores a limit below 80%', () => {
    expect(pillFigure({ context: 90, fiveHour: { used: 95 } })).toMatchObject({ label: t.contextLabel('90%'), high: true });
    expect(pillFigure({ context: 42, fiveHour: { used: 79 } })).toMatchObject({ label: t.contextLabel('42%'), high: false });
  });

  it('shows a limit running out before the context is known, and nothing when neither is', () => {
    expect(pillFigure({ fiveHour: { used: 91 } })).toMatchObject({ label: t.fiveHourLabel('91%'), high: true });
    expect(pillFigure({ fiveHour: { used: 10 } })).toBeNull();
  });
});
