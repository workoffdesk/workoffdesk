import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Slow } from '../../src/base/api';
import { createSlowReport, SLOW_PATH } from '../../src/base/slow';

const slow = (path: string, ms = 4000): Slow => ({ method: 'GET', path, ms, outcome: 200 });
const reporter = (tell: (s: Slow[]) => Promise<unknown> = async () => {}) => {
  const told: Slow[][] = [];
  const report = createSlowReport((s) => {
    told.push(s);
    return tell(s);
  });
  return { report, told };
};

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

describe('createSlowReport', () => {
  it('reports the slow requests of the next 3 seconds in one, counted from the first', () => {
    const { report, told } = reporter();
    report(slow('/api/a'));
    vi.advanceTimersByTime(2000);
    report(slow('/api/b'));
    vi.advanceTimersByTime(999);
    expect(told).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(told).toEqual([[slow('/api/a'), slow('/api/b')]]);
  });

  it('starts gathering afresh once they are reported', () => {
    const { report, told } = reporter();
    report(slow('/api/a'));
    vi.advanceTimersByTime(3000);
    report(slow('/api/b'));
    vi.advanceTimersByTime(3000);
    expect(told).toEqual([[slow('/api/a')], [slow('/api/b')]]);
  });

  it('reports at most the first 20', () => {
    const { report, told } = reporter();
    const all = Array.from({ length: 25 }, (_, i) => slow(`/api/${i}`));
    for (const s of all) report(s);
    vi.advanceTimersByTime(3000);
    expect(told).toEqual([all.slice(0, 20)]);
  });

  it('never reports on its own report', () => {
    const { report, told } = reporter();
    report(slow(SLOW_PATH));
    vi.advanceTimersByTime(3000);
    expect(told).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    report(slow('/api/a'));
    report(slow(SLOW_PATH));
    vi.advanceTimersByTime(3000);
    expect(told).toEqual([[slow('/api/a')]]);
  });

  it('lets a report fail quietly and reports the next ones all the same', async () => {
    const { report, told } = reporter(() => Promise.reject(new TypeError('Network request failed')));
    report(slow('/api/a'));
    await vi.advanceTimersByTimeAsync(3000);
    report(slow('/api/b'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(told).toEqual([[slow('/api/a')], [slow('/api/b')]]);
  });
});
