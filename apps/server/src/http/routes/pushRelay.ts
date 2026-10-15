import type { Apns } from '../../notify/apns.js';
import { PUBLIC, type RouteModule } from './context.js';

// On the server of whoever publishes the App Store app: other people's Macs hand it notifications for that
// app, sealed for the phone (notify/seal.ts), to pass on to Apple with this server's key. It needs no sign-in,
// as those Macs have none here; it cannot read what it passes on, and it delivers to no other app.

const MINUTE = 60_000;
const PER_DEVICE = 30;
const IN_ALL = 600;
// Apple takes 4 KB of payload; this leaves room for the rest of it.
const SEALED_MAX = 3000;

type Relayed = { token: string; topic: string; sealed: string; thread: string; hidden: string };

export const register =
  (relay: Apns): RouteModule =>
  (app, { now }) => {
    const limit = minuteLimits(now);
    app.post<{ Body: unknown }>('/api/push/relay', { ...PUBLIC, bodyLimit: 8 * 1024 }, async (req, reply) => {
      const r = parse(req.body);
      if (!r) return reply.code(400).send({ error: 'invalid notification' });
      if (r.topic !== relay.relayTopic) return reply.code(403).send({ error: 'not an app this server relays for' });
      const wait = limit(r.token);
      if (wait) return reply.code(429).header('retry-after', String(wait)).send({ error: 'too many' });
      const payload = { aps: { alert: { body: r.hidden }, sound: 'default', 'mutable-content': 1, 'thread-id': r.thread }, sealed: r.sealed };
      const { gone, sent } = await relay.send({ token: r.token, topic: r.topic }, payload, r.thread);
      if (gone) return reply.code(410).send({ error: 'device gone' });
      return sent ? reply.code(200).send({}) : reply.code(502).send({ error: 'not taken' });
    });
  };

function parse(body: unknown): Relayed | null {
  const b = body as Partial<Record<keyof Relayed, unknown>> | null;
  if (!b || typeof b.token !== 'string' || !/^[0-9a-f]{64}$/i.test(b.token)) return null;
  if (typeof b.topic !== 'string') return null;
  if (typeof b.sealed !== 'string' || b.sealed.length > SEALED_MAX || !/^[A-Za-z0-9+/]+={0,2}$/.test(b.sealed)) return null;
  if (typeof b.thread !== 'string' || !/^[0-9a-f]{16}$/.test(b.thread)) return null;
  if (typeof b.hidden !== 'string' || !b.hidden || b.hidden.length > 120) return null;
  return { token: b.token, topic: b.topic, sealed: b.sealed, thread: b.thread, hidden: b.hidden };
}

// How many a minute one device, and all of them, may be sent; the seconds to wait when over, else 0.
function minuteLimits(now: () => number) {
  let minute = -1;
  let all = 0;
  const each = new Map<string, number>();
  return (token: string): number => {
    const t = now();
    const m = Math.floor(t / MINUTE);
    if (m !== minute) {
      minute = m;
      all = 0;
      each.clear();
    }
    const mine = each.get(token) ?? 0;
    if (mine >= PER_DEVICE || all >= IN_ALL) return Math.ceil(((m + 1) * MINUTE - t) / 1000);
    each.set(token, mine + 1);
    all++;
    return 0;
  };
}
