import { VERSION } from '../../system/version.js';
import { PUBLIC, type RouteModule } from './context.js';

// For a supervisor or a deploy to ask "are you up, and which build": nothing about sessions or the user.
export const register: RouteModule = (app, ctx) => {
  const { store, machine } = ctx.deps;
  // Requests that arrive while a check runs share it: the route is public, and each check starts tmux.
  let running: Promise<unknown> | null = null;
  const check = () => (running ??= machine.listSessions().finally(() => (running = null)));
  app.get('/healthz', PUBLIC, async (_req, reply) => {
    try {
      store.get();
      await check();
      return { ok: true, version: VERSION };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  // A signed-in device's requests that took it long (libs/client slow.ts), logged beside the server's own:
  // the server answers in milliseconds what a phone may wait seconds for.
  app.post<{ Body: { slow?: unknown } }>('/api/slow', async (req, reply) => {
    const slow = req.body?.slow;
    if (!Array.isArray(slow) || slow.length > SLOW_MAX) return reply.code(400).send({ error: 'bad report' });
    for (const s of slow) {
      if (!isSlow(s)) continue;
      req.log.info({ method: s.method, path: s.path.slice(0, 200), ms: s.ms, outcome: s.outcome, device: req.headers['user-agent'] }, 'slow on device');
    }
    return reply.code(204).send();
  });

  // A phone's chat that came to rest at its scroll view's end with the last row still under the dock
  // (mobile ChatList): what the list, the scroll view and the screen each measured then.
  app.post<{ Body: { numbers?: unknown } }>('/api/chat-end', async (req, reply) => {
    const numbers = req.body?.numbers;
    if (!isNumbers(numbers)) return reply.code(400).send({ error: 'bad report' });
    req.log.info({ ...numbers, device: req.headers['user-agent'] }, 'chat end hidden on device');
    return reply.code(204).send();
  });
};

const NUMBERS_MAX = 16;
const isNumbers = (x: unknown): x is Record<string, number | null> =>
  typeof x === 'object' &&
  x !== null &&
  !Array.isArray(x) &&
  Object.keys(x).length <= NUMBERS_MAX &&
  Object.entries(x).every(([k, v]) => /^[a-zA-Z]{1,24}$/.test(k) && (v === null || Number.isFinite(v)));

const SLOW_MAX = 20;
type Slow = { method: string; path: string; ms: number; outcome: number | 'network' };
const isSlow = (s: unknown): s is Slow => {
  const x = s as Partial<Slow> | null;
  return (
    typeof x?.method === 'string' &&
    typeof x.path === 'string' &&
    x.path.startsWith('/api/') &&
    Number.isSafeInteger(x.ms) &&
    (Number.isSafeInteger(x.outcome) || x.outcome === 'network')
  );
};
