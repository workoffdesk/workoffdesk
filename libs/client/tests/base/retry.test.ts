import { describe, expect, it } from 'vitest';
import { isTransient, restartDelay, withRetry } from '../../src/base/retry';

const noSleep = async () => {};
class E extends Error {
  constructor(readonly status: number | 'network') {
    super(String(status));
  }
}

describe('withRetry', () => {
  it('tries again through a passing blip and returns what came back', async () => {
    let n = 0;
    const v = await withRetry(
      async () => {
        if (n++ < 2) throw new E(502);
        return 'ok';
      },
      { sleep: noSleep },
    );
    expect(v).toBe('ok');
    expect(n).toBe(3);
  });

  it('waits the given delays between tries, in order', async () => {
    const waited: number[] = [];
    await expect(
      withRetry(
        async () => {
          throw new E('network');
        },
        { sleep: async (ms) => void waited.push(ms) },
      ),
    ).rejects.toThrow();
    expect(waited).toEqual([300, 1000, 2000]);
  });

  it('gives up after the last delay with the last error', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new E(503);
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow('503');
    expect(n).toBe(4);
  });

  it('counts a fetch that never reached the server as passing', async () => {
    let n = 0;
    const v = await withRetry(
      async () => {
        if (n++ === 0) throw new TypeError('Load failed');
        return 'ok';
      },
      { sleep: noSleep },
    );
    expect(v).toBe('ok');
  });

  it.each([400, 401, 403, 404, 409, 500])('does not try again after a %i', async (status) => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new E(status);
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow();
    expect(n).toBe(1);
  });
});

describe('restartDelay', () => {
  it.each([
    [0, 250],
    [0.5, 500],
    [0.999, 750],
  ])('waits %f of the way between 250 and 750 ms after a restart', (r, ms) => {
    expect(Math.round(restartDelay(() => r))).toBe(ms);
  });
});

describe('isTransient', () => {
  it('counts a lost network and gateway errors as passing, and nothing else', () => {
    expect([502, 503, 504, 'network' as const].every(isTransient)).toBe(true);
    expect([500, 404, 401].some(isTransient)).toBe(false);
  });
});
