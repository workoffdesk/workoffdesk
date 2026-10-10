import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, startPress } from '../../src/composer/hold';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('startPress', () => {
  it('treats a release before HOLD_MS as a tap and holds nothing', () => {
    const onHeld = vi.fn();
    const p = startPress(onHeld);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(p.held()).toBe(false);
    expect(p.end()).toBe('tap');
    vi.advanceTimersByTime(HOLD_MS);
    expect(onHeld).not.toHaveBeenCalled();
  });

  it('holds once when kept down for HOLD_MS', () => {
    const onHeld = vi.fn();
    const p = startPress(onHeld);
    vi.advanceTimersByTime(HOLD_MS);
    expect(p.held()).toBe(true);
    vi.advanceTimersByTime(HOLD_MS * 3);
    expect(onHeld).toHaveBeenCalledTimes(1);
    expect(p.end()).toBe('held');
  });
});
