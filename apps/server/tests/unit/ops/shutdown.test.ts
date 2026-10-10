import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shutdownOnce } from '../../../src/ops/shutdown';

describe('shutdownOnce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('exits 0 once everything has closed', async () => {
    const exit = vi.fn();
    const stop = shutdownOnce(async () => {}, { timeoutMs: 10_000, exit });
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits 1 when closing hangs past the limit', async () => {
    const exit = vi.fn();
    const stop = shutdownOnce(() => new Promise(() => {}), { timeoutMs: 10_000, exit });
    stop();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 when closing fails', async () => {
    const exit = vi.fn();
    const stop = shutdownOnce(async () => Promise.reject(new Error('stuck')), { timeoutMs: 10_000, exit });
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('closes once however many signals arrive', async () => {
    const close = vi.fn(async () => {});
    const stop = shutdownOnce(close, { timeoutMs: 10_000, exit: vi.fn() });
    stop();
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
