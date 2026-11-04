import type { KeyValue } from './platform';

// Which of a Mac's addresses the phone goes to: the one that answered first when they were last asked, kept
// until a request there gets no answer.

// Resolves once the address answered well; rejects otherwise, or once the signal aborts.
export type Probe = (base: string, signal: AbortSignal) => Promise<void>;

export type Route = ReturnType<typeof createRoute>;

export function createRoute({ probe, timeoutMs = 5000, gapMs = 10_000, now = Date.now }: { probe: Probe; timeoutMs?: number; gapMs?: number; now?: () => number }) {
  let addresses: string[] = [];
  let current = '';
  let running: Promise<void> | null = null;
  let checkedAt = -Infinity;
  const listeners = new Set<() => void>();

  const moveTo = (base: string) => {
    if (base === current) return;
    current = base;
    for (const l of [...listeners]) l();
  };

  async function race(asked: string[]): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const winner = await Promise.any(asked.map((base) => probe(base, controller.signal).then(() => base)));
      if (addresses === asked) moveTo(winner);
    } catch {
      // none answered: the address in use stays
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  const route = {
    base: () => current,
    addresses: () => addresses,
    // The Mac's addresses: the one in use stays while it is among them, else the one preferred, else the first.
    use(list: string[], preferred?: string) {
      addresses = list;
      moveTo(list.includes(current) ? current : preferred && list.includes(preferred) ? preferred : (list[0] ?? ''));
    },
    // Asks every address at once and goes on with the first to answer.
    check(): Promise<void> {
      if (addresses.length < 2) return Promise.resolve();
      checkedAt = now();
      return (running ??= race(addresses).finally(() => (running = null)));
    },
    // A request at `at` got no answer: when that is the address in use, the addresses are asked again, once
    // in a while however many requests find it.
    failed(at: string) {
      if (at !== current || now() - checkedAt < gapMs) return;
      void route.check();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return route;
}

// The address last used for an account, kept on the device so a cold start begins on the line that worked.
const ROUTE_KEY = 'workoffdesk.route';

export function keptRoute(storage: KeyValue, server: string): string | undefined {
  try {
    const kept = JSON.parse(storage.getItem(ROUTE_KEY) ?? 'null') as { server?: unknown; base?: unknown } | null;
    return kept?.server === server && typeof kept.base === 'string' ? kept.base : undefined;
  } catch {
    return undefined;
  }
}

export function keepRoute(storage: KeyValue, server: string, base: string): void {
  try {
    storage.setItem(ROUTE_KEY, JSON.stringify({ server, base }));
  } catch {
    // the next cold start begins on the first address
  }
}
