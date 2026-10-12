import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DETAIL_MAX, recentProblems } from '../../../src/ops/problems.js';

const T0 = Date.UTC(2026, 9, 7, 8, 0, 0);
const line = (level: number, msg: string, n = 0, extra: object = {}) => JSON.stringify({ level, time: T0 + n * 1000, pid: 1, hostname: 'mac', msg, ...extra });

const logIn = (lines: string[], older: string[] = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'ts-problems-'));
  const file = join(dir, 'workoffdesk.log');
  writeFileSync(file, lines.map((l) => `${l}\n`).join(''));
  if (older.length) writeFileSync(`${file}.1`, older.map((l) => `${l}\n`).join(''));
  return file;
};

describe('recentProblems', () => {
  it('returns the lines at warn or above, newest first, with when and how bad', () => {
    const file = logIn([line(30, 'started', 0), line(40, 'slow tmux', 1), line(50, 'request failed', 2), line(60, 'gave up', 3)]);
    expect(recentProblems(file)).toEqual([
      { at: new Date(T0 + 3000).toISOString(), level: 'fatal', msg: 'gave up', detail: '{}', count: 1 },
      { at: new Date(T0 + 2000).toISOString(), level: 'error', msg: 'request failed', detail: '{}', count: 1 },
      { at: new Date(T0 + 1000).toISOString(), level: 'warn', msg: 'slow tmux', detail: '{}', count: 1 },
    ]);
  });

  it('carries the rest of the line as its detail, without the pid and host', () => {
    const file = logIn([line(50, 'request failed', 0, { err: { type: 'Error', message: 'boom' }, url: '/api/x' })]);
    expect(JSON.parse(recentProblems(file)[0].detail)).toEqual({ err: { type: 'Error', message: 'boom' }, url: '/api/x' });
  });

  it(`cuts a long detail at ${DETAIL_MAX} characters`, () => {
    const file = logIn([line(50, 'big', 0, { stack: 'x'.repeat(DETAIL_MAX * 2) })]);
    expect(recentProblems(file)[0].detail.length).toBe(DETAIL_MAX);
  });

  it('goes on into the file the log was last rotated into', () => {
    const file = logIn([line(50, 'new', 2)], [line(50, 'old', 1)]);
    expect(recentProblems(file).map((p) => p.msg)).toEqual(['new', 'old']);
  });

  it('returns at most the number asked for, the newest', () => {
    const file = logIn(Array.from({ length: 80 }, (_, i) => line(50, `e${i}`, i)));
    const got = recentProblems(file, 50);
    expect(got).toHaveLength(50);
    expect(got[0].msg).toBe('e79');
  });

  it('says the same problem once, as it was last, with how many times it came, among others in between', () => {
    const file = logIn([line(50, 'request failed', 1, { url: '/a' }), line(40, 'slow tmux', 2), line(50, 'request failed', 3, { url: '/b' })]);
    expect(recentProblems(file)).toEqual([
      { at: new Date(T0 + 3000).toISOString(), level: 'error', msg: 'request failed', detail: '{"url":"/b"}', count: 2 },
      { at: new Date(T0 + 2000).toISOString(), level: 'warn', msg: 'slow tmux', detail: '{}', count: 1 },
    ]);
  });

  it('keeps apart the same words at another level, and counts on into the rotated file', () => {
    const file = logIn([line(50, 'slow', 2), line(40, 'slow', 3)], [line(40, 'slow', 1)]);
    expect(recentProblems(file).map((p) => [p.level, p.count])).toEqual([
      ['warn', 2],
      ['error', 1],
    ]);
  });

  it('counts the same problem as one toward the number asked for, so others behind it still show', () => {
    const file = logIn([line(50, 'other', 0), ...Array.from({ length: 80 }, (_, i) => line(50, 'request failed', i + 1))]);
    expect(recentProblems(file, 50).map((p) => [p.msg, p.count])).toEqual([
      ['request failed', 80],
      ['other', 1],
    ]);
  });

  it('skips what is not a log line: a cut-off last line, plain text', () => {
    const file = logIn([line(50, 'good', 1), 'not json', '{"level":50,"time":']);
    expect(recentProblems(file).map((p) => p.msg)).toEqual(['good']);
  });

  it('returns none when there is no log yet', () => {
    expect(recentProblems(join(tmpdir(), 'no-such-dir-xyz', 'workoffdesk.log'))).toEqual([]);
  });
});
