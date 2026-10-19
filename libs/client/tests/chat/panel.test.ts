import { describe, expect, it } from 'vitest';
import { taskKeys, TASK_BACK, TASK_STOP } from '../../src/chat/panel';

const UP = '\x1b[A';
const DOWN = '\x1b[B';
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `task ${i}`, status: 'running' }));

describe('taskKeys', () => {
  it.each([
    ['the row selected', 1, 1, ''],
    ['a row below it', 0, 2, DOWN + DOWN],
    ['a row above it', 2, 0, UP + UP],
  ])('moves to %s, then views or stops it', (_, at, to, moves) => {
    expect(taskKeys({ rows: rows(3), at }, to, 'view')).toBe(`${moves}\r`);
    expect(taskKeys({ rows: rows(3), at }, to, 'stop')).toBe(`${moves}${TASK_STOP}`);
  });

  it('types nothing for a row the list does not have', () => {
    expect(taskKeys({ rows: rows(2), at: 0 }, 2, 'stop')).toBe('');
    expect(taskKeys({ rows: rows(2), at: 0 }, -1, 'view')).toBe('');
  });

  it('goes back from a task to the list with ←', () => {
    expect(TASK_BACK).toBe('\x1b[D');
  });
});
