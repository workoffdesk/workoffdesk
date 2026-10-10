import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalMachine } from '../../../src/sessions/machine.js';
import { Store } from '../../../src/system/store.js';
import { Tmux } from '../../../src/system/tmux.js';

// The tmux server is never started: every listing below is replaced, and the clock is fake.
function machineWithListing() {
  const dir = mkdtempSync(join(tmpdir(), 'ts-watch-'));
  const m = new LocalMachine({ tmux: new Tmux({ socket: 'unused', conf: '/dev/null' }), store: new Store(join(dir, 's.json')), claudeSettingsPath: '/dev/null' });
  const pending: Array<() => void> = [];
  let calls = 0;
  m.listSessions = () => {
    calls++;
    return new Promise((r) => pending.push(() => r([])));
  };
  return { m, calls: () => calls, finishOne: () => pending.shift()?.() };
}

describe('LocalMachine', () => {
  describe('watch', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('starts no listing while the last one is still running, however long it takes', async () => {
      const { m, calls } = machineWithListing();
      const stop = m.watch(500);
      await vi.advanceTimersByTimeAsync(500);
      expect(calls()).toBe(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls()).toBe(1);
      stop();
    });

    it('lists again one interval after the last listing ends', async () => {
      const { m, calls, finishOne } = machineWithListing();
      const stop = m.watch(500);
      await vi.advanceTimersByTimeAsync(500);
      finishOne();
      await vi.advanceTimersByTimeAsync(499);
      expect(calls()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls()).toBe(2);
      stop();
    });

    it('keeps watching after a listing fails', async () => {
      const { m } = machineWithListing();
      let calls = 0;
      m.listSessions = async () => {
        calls++;
        throw new Error('tmux went away');
      };
      const stop = m.watch(500);
      await vi.advanceTimersByTimeAsync(1500);
      expect(calls).toBe(3);
      stop();
    });

    it('lists nothing more once stopped, even when stopped during a listing', async () => {
      const { m, calls, finishOne } = machineWithListing();
      const stop = m.watch(500);
      await vi.advanceTimersByTimeAsync(500);
      stop();
      finishOne();
      await vi.advanceTimersByTimeAsync(5000);
      expect(calls()).toBe(1);
    });
  });
});
