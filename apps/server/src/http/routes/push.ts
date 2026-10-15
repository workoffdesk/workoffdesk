import { isDeepStrictEqual } from 'node:util';
import type { ApnsDeviceRecord, ApnsRelay } from '../../system/store.js';
import type { RouteModule } from './context.js';

// The phones that get a notification when Claude needs an answer.
export const register: RouteModule = (app, ctx) => {
  const { deps, now } = ctx;
  const { store, pusher } = deps;

  app.get('/api/push/key', async (_req, reply) => {
    const vapid = store.get().vapid;
    return vapid ? { publicKey: vapid.publicKey } : reply.code(404).send({ error: 'push not configured' });
  });

  app.post<{ Body: unknown }>('/api/push/subscribe', async (req, reply) => {
    const sub = parseSubscription(req.body);
    if (!sub) return reply.code(400).send({ error: 'invalid subscription' });
    store.update((s) => {
      s.pushSubs = [...s.pushSubs.filter((x) => x.endpoint !== sub.endpoint), { ...sub, createdAt: now() }];
    });
    return reply.code(204).send();
  });

  app.delete<{ Body: { endpoint?: unknown } }>('/api/push/subscribe', async (req, reply) => {
    const endpoint = req.body?.endpoint;
    store.update((s) => {
      s.pushSubs = s.pushSubs.filter((x) => x.endpoint !== endpoint);
    });
    return reply.code(204).send();
  });

  // The iPhone app: ready says whether this server can reach it, with its own key or through the relay the
  // app names (relay=1).
  app.get<{ Querystring: { relay?: string } }>('/api/push/apns', async (req) => ({ ready: req.query.relay === '1' || !!pusher?.toPhones }));

  app.post<{ Body: unknown }>('/api/push/apns', async (req, reply) => {
    const d = parseDevice(req.body);
    if (!d) return reply.code(400).send({ error: 'invalid device' });
    // A phone tells its token on every start and whenever iOS hands it out: what is known already is not
    // written again.
    const was = store.get().apnsDevices.find((x) => x.token === d.token);
    if (was && isDeepStrictEqual({ topic: was.topic, words: was.words, relay: was.relay }, { topic: d.topic, words: d.words, relay: d.relay })) return reply.code(204).send();
    store.update((s) => {
      const was = s.apnsDevices.find((x) => x.token === d.token);
      s.apnsDevices = [...s.apnsDevices.filter((x) => x.token !== d.token), { ...d, host: was?.host, createdAt: was?.createdAt ?? now() }];
    });
    return reply.code(204).send();
  });

  app.delete<{ Body: { token?: unknown } }>('/api/push/apns', async (req, reply) => {
    const token = req.body?.token;
    store.update((s) => {
      s.apnsDevices = s.apnsDevices.filter((x) => x.token !== token);
    });
    return reply.code(204).send();
  });
};

const words = (v: unknown, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;

type Device = Pick<ApnsDeviceRecord, 'token' | 'topic' | 'words' | 'relay'>;

function parseDevice(body: unknown): Device | null {
  const b = body as { token?: unknown; topic?: unknown; words?: { waiting?: unknown; idle?: unknown; hidden?: unknown }; relay?: unknown } | null;
  if (!b || typeof b.token !== 'string' || !/^[0-9a-f]{64,200}$/i.test(b.token)) return null;
  if (typeof b.topic !== 'string' || !/^[A-Za-z0-9.-]{1,155}$/.test(b.topic)) return null;
  if (!words(b.words?.waiting) || !words(b.words?.idle)) return null;
  const hidden = b.words?.hidden;
  if (hidden !== undefined && !words(hidden, 120)) return null;
  const relay = b.relay === undefined ? undefined : parseRelay(b.relay);
  if (relay === null || (relay && hidden === undefined)) return null;
  return {
    token: b.token,
    topic: b.topic,
    words: { waiting: b.words!.waiting as string, idle: b.words!.idle as string, ...(hidden === undefined ? {} : { hidden: hidden as string }) },
    ...(relay ? { relay } : {}),
  };
}

// An https origin, and a 32-byte key in base64.
function parseRelay(v: unknown): ApnsRelay | null {
  const r = v as { url?: unknown; key?: unknown } | null;
  if (!r || typeof r.url !== 'string' || typeof r.key !== 'string') return null;
  let url: URL;
  try {
    url = new URL(r.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.origin !== r.url.replace(/\/$/, '')) return null;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(r.key) || Buffer.from(r.key, 'base64').length !== 32) return null;
  return { url: url.origin, key: r.key };
}

function parseSubscription(body: unknown): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!b || typeof b.endpoint !== 'string' || b.endpoint.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(b.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const { p256dh, auth } = b.keys ?? {};
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !p256dh || !auth) return null;
  return { endpoint: b.endpoint, keys: { p256dh, auth } };
}
