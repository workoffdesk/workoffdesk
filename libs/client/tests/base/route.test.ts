import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoute, keepRoute, keptRoute, type Probe } from '../../src/base/route';

const A = 'https://a.example';
const B = 'https://b.example';
const C = 'https://c.example';

// Each address answers after its delay in ms, or never (null), or refuses at once ('refuse').
function net(delays: Record<string, number | null | 'refuse'>) {
  const asked: string[] = [];
  const probe: Probe = (base, signal) => {
    asked.push(base);
    const d = delays[base];
    if (d === 'refuse') return Promise.reject(new TypeError('refused'));
    return new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      if (d !== null && d !== undefined) setTimeout(resolve, d);
    });
  };
  return { probe, asked };
}

describe('createRoute', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('moves to the address that answers first', async () => {
    const route = createRoute({ probe: net({ [A]: 900, [B]: 50 }).probe });
    route.use([A, B]);
    expect(route.base()).toBe(A);
    const done = route.check();
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(route.base()).toBe(B);
  });

  it.each([
    ['refuses', 'refuse' as const],
    ['never answers', null],
  ])('leaves an address that %s for one that answers', async (_, dead) => {
    const route = createRoute({ probe: net({ [A]: dead, [B]: 300 }).probe });
    route.use([A, B]);
    const done = route.check();
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(route.base()).toBe(B);
  });

  it('stays where it is when no address answers', async () => {
    const route = createRoute({ probe: net({ [A]: 'refuse', [B]: null }).probe });
    route.use([A, B], B);
    const done = route.check();
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    expect(route.base()).toBe(B);
  });

  it('asks nothing when the Mac has one address', async () => {
    const { probe, asked } = net({ [A]: 10 });
    const route = createRoute({ probe });
    route.use([A]);
    await route.check();
    expect(asked).toEqual([]);
    expect(route.base()).toBe(A);
  });

  it('shares one check among the calls made while it runs', async () => {
    const { probe, asked } = net({ [A]: 100, [B]: 200 });
    const route = createRoute({ probe });
    route.use([A, B]);
    const both = Promise.all([route.check(), route.check()]);
    await vi.advanceTimersByTimeAsync(300);
    await both;
    expect(asked).toEqual([A, B]);
  });

  describe('failed', () => {
    it('checks once when the address in use stops answering, however many requests find it', async () => {
      const { probe, asked } = net({ [A]: 'refuse', [B]: 40 });
      const route = createRoute({ probe, gapMs: 10_000 });
      route.use([A, B]);
      route.failed(A);
      route.failed(A);
      await vi.advanceTimersByTimeAsync(100);
      route.failed(A);
      await vi.advanceTimersByTimeAsync(100);
      expect(route.base()).toBe(B);
      expect(asked).toEqual([A, B]);
    });

    it('passes over a failure at an address no longer in use', async () => {
      const { probe, asked } = net({ [A]: 10, [B]: 10 });
      const route = createRoute({ probe });
      route.use([A, B], B);
      route.failed(A);
      await vi.advanceTimersByTimeAsync(100);
      expect(asked).toEqual([]);
    });

    it('checks again after the gap', async () => {
      const delays: Record<string, number | 'refuse'> = { [A]: 'refuse', [B]: 10 };
      const { probe, asked } = net(delays);
      const route = createRoute({ probe, gapMs: 10_000 });
      route.use([A, B]);
      route.failed(A);
      await vi.advanceTimersByTimeAsync(100);
      expect(route.base()).toBe(B);
      delays[A] = 10;
      delays[B] = 'refuse';
      route.failed(B);
      await vi.advanceTimersByTimeAsync(100);
      expect(route.base()).toBe(B);
      await vi.advanceTimersByTimeAsync(10_000);
      route.failed(B);
      await vi.advanceTimersByTimeAsync(100);
      expect(route.base()).toBe(A);
      expect(asked.length).toBe(4);
    });
  });

  describe('use', () => {
    it('keeps the address in use while it is still one of them', () => {
      const route = createRoute({ probe: net({}).probe });
      route.use([A, B], B);
      route.use([A, B, C], A);
      expect(route.base()).toBe(B);
    });

    it('starts on the one preferred when it is among them, else on the first', () => {
      const route = createRoute({ probe: net({}).probe });
      route.use([A, B], C);
      expect(route.base()).toBe(A);
      route.use([B, C], C);
      expect(route.base()).toBe(C);
      route.use([], A);
      expect(route.base()).toBe('');
    });

    it('drops a check under way for addresses no longer known', async () => {
      const route = createRoute({ probe: net({ [A]: 500, [B]: 20 }).probe });
      route.use([A, B]);
      const done = route.check();
      route.use([C]);
      await vi.advanceTimersByTimeAsync(1000);
      await done;
      expect(route.base()).toBe(C);
    });
  });

  it('tells its listeners when the address in use changes, and only then', async () => {
    const route = createRoute({ probe: net({ [A]: 300, [B]: 10 }).probe });
    const heard: string[] = [];
    route.subscribe(() => heard.push(route.base()));
    route.use([A, B]);
    route.use([A, B]);
    const done = route.check();
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(heard).toEqual([A, B]);
  });
});

describe('the address kept for a cold start', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('is the one last used for that account, and nothing for another', () => {
    const s = store();
    keepRoute(s, A, B);
    expect(keptRoute(s, A)).toBe(B);
    expect(keptRoute(s, C)).toBeUndefined();
  });

  it.each([
    ['nothing kept', () => {}],
    ['what is kept cannot be read', (s: ReturnType<typeof store>) => s.setItem('workoffdesk.route', '{')],
    [
      'the store throws',
      (s: ReturnType<typeof store>) => {
        s.getItem = () => {
          throw new Error('blocked');
        };
      },
    ],
  ])('is nothing when %s', (_, spoil) => {
    const s = store();
    spoil(s);
    expect(keptRoute(s, A)).toBeUndefined();
  });

  it('is not kept when the store throws, without a word', () => {
    const s = store();
    s.setItem = () => {
      throw new Error('full');
    };
    expect(() => keepRoute(s, A, B)).not.toThrow();
  });
});
