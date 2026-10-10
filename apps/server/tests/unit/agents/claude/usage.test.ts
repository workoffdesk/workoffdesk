import { describe, expect, it } from 'vitest';
import { usageFrom } from '../../../../src/agents/claude/usage.js';

// What Claude Code's status line command is given, in the shape v2.1 sends it; the phone shows it as the
// session's usage.
const STATUS = {
  session_id: '6f1c2a3b-0000-4000-8000-000000000001',
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  effort: { level: 'high' },
  context_window: { used_percentage: 42.5, total_input_tokens: 85_000 },
  rate_limits: { five_hour: { used_percentage: 12, resets_at: 1_791_000_000 }, seven_day: { used_percentage: 3.25 } },
  cost: { total_cost_usd: 1.75, total_lines_added: 120, total_lines_removed: 0 },
};

describe('usageFrom', () => {
  it('reads its model, effort, how full its context is, the limits used and what it cost', () => {
    expect(usageFrom(STATUS)).toStrictEqual({
      model: 'Opus 5.5',
      effort: 'high',
      context: 42.5,
      fiveHour: { used: 12, resetsAt: 1_791_000_000 },
      sevenDay: { used: 3.25 },
      cost: 1.75,
      added: 120,
      removed: 0,
    });
  });

  it.each<[string, unknown, string | undefined]>([
    ['its name', { id: 'claude-opus-5-5', display_name: 'Opus 5.5' }, 'Opus 5.5'],
    ['its id, when it has no name', { id: 'claude-opus-5-5', display_name: '' }, 'claude-opus-5-5'],
    ['the model, when it is given as a name alone', 'claude-sonnet-5-5', 'claude-sonnet-5-5'],
    ['no more than the pill has room for', { display_name: 'x'.repeat(100) }, 'x'.repeat(80)],
    ['nothing, when it is not a name', { display_name: 7, id: null }, undefined],
  ])('names the model by %s', (_, model, named) => {
    expect(usageFrom({ model, cost: { total_cost_usd: 1 } })?.model).toBe(named);
  });

  it('shows no more than all of a context or a limit used', () => {
    const u = usageFrom({ context_window: { used_percentage: 130 }, rate_limits: { five_hour: { used_percentage: 101 } } });
    expect([u?.context, u?.fiveHour]).toStrictEqual([100, { used: 100 }]);
  });

  it.each<[string, unknown]>([
    ['a string', '42'],
    ['negative', -1],
    ['not a number', Number.NaN],
    ['without end', Number.POSITIVE_INFINITY],
    ['null', null],
  ])('leaves out a number that is %s', (_, n) => {
    const u = usageFrom({
      model: 'm',
      context_window: { used_percentage: n },
      rate_limits: { five_hour: { used_percentage: n }, seven_day: { used_percentage: 5, resets_at: n } },
      cost: { total_cost_usd: n, total_lines_added: n, total_lines_removed: n },
    });
    expect(u).toStrictEqual({ model: 'm', sevenDay: { used: 5 } });
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['not an object', 'Opus'],
    ['a list', [STATUS]],
    ['an object of nothing it reads', { session_id: 'x', rate_limits: { five_hour: {} }, effort: 'high' }],
  ])('reads none from %s', (_, payload) => {
    expect(usageFrom(payload)).toBeNull();
  });
});
