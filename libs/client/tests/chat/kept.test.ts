import { describe, expect, it } from 'vitest';
import { chatsToDrop, KEEP_CHATS, KEEP_MS, type Shown } from '../../src/chat/kept';

const NOW = Date.parse('2026-10-17T12:00:00.000Z');
const shownAgo = (ms: number[]): Shown[] => ms.map((ago, i) => ({ id: `c${i}`, at: NOW - ago }));

describe('chatsToDrop', () => {
  it.each<[string, number[], string[]]>([
    ['keeps nothing back when none are kept', [], []],
    ['keeps those shown within the month', [0, 1000, KEEP_MS], []],
    ['drops those not shown for longer than a month', [KEEP_MS + 1, 0, 40 * KEEP_MS], ['c0', 'c2']],
    ['keeps one shown after now, by a clock set back since', [-5000], []],
  ])('%s', (_, ago, dropped) => {
    expect(chatsToDrop(shownAgo(ago), NOW).sort()).toEqual(dropped);
  });

  it('keeps the ones shown last up to its count, and drops the rest, whatever order they come in', () => {
    const shown = shownAgo(Array.from({ length: KEEP_CHATS + 3 }, (_, i) => i * 1000)).reverse();
    expect(KEEP_CHATS + 3).toBeLessThan(KEEP_MS / 1000);
    expect(chatsToDrop(shown, NOW).sort()).toEqual([`c${KEEP_CHATS}`, `c${KEEP_CHATS + 1}`, `c${KEEP_CHATS + 2}`]);
  });
});
