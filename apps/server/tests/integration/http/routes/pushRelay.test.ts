import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../../../src/http/app.js';
import { Journal } from '../../../../src/journal/index.js';
import { Apns, type ApnsPost } from '../../../../src/notify/apns.js';
import type { LocalMachine } from '../../../../src/sessions/machine.js';
import { Store } from '../../../../src/system/store.js';

// The server of whoever publishes the App Store app passes other people's Macs' sealed notifications on to
// Apple for that app. It cannot read them, needs no sign-in, and delivers to no other app.

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const TOPIC = 'com.example.store';
const machine = {
  id: 'local',
  watch: () => () => {},
  onChange: () => () => {},
  listSessions: async () => [],
  journal: new Journal({ file: ':memory:', log: () => {} }),
} as unknown as LocalMachine;

const TOKEN = 'f'.repeat(64);
const SEALED = Buffer.alloc(80, 9).toString('base64');
const relayed = (o: Record<string, unknown> = {}) => ({ token: TOKEN, topic: TOPIC, sealed: SEALED, thread: '0123456789abcdef', hidden: 'New on your Mac', ...o });

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(o: { relayTopic?: string; answer?: () => { status: number; reason?: string }; at?: () => number } = {}) {
  const post = vi.fn<ApnsPost>(async () => (o.answer ?? (() => ({ status: 200 })))());
  let log = '';
  const logger = pino({ level: 'info' }, new Writable({ write: (c, _e, done) => ((log += c.toString()), done()) }));
  const relay = new Apns({ teamId: 'TEAM123456', keyId: 'KEY1234567', key: privateKey, relayTopic: o.relayTopic ?? TOPIC }, post);
  const home = mkdtempSync(join(tmpdir(), 'ts-relay-'));
  ({ app } = await buildApp({
    store: new Store(join(home, 'state.json')),
    machine,
    origin: 'https://mac.tail.ts.net',
    rpId: 'mac.tail.ts.net',
    auditPath: join(home, 'audit.log'),
    logger,
    now: o.at,
    ...(o.relayTopic === '' ? {} : { relay }),
  }));
  const send = (body: unknown) => app!.inject({ method: 'POST', url: '/api/push/relay', payload: body as object });
  return { post, send, log: () => log };
}

describe('POST /api/push/relay', () => {
  it('passes a sealed notification to Apple for the app it relays for, without a sign-in', async () => {
    const { post, send } = await start();
    const res = await send(relayed());
    expect(res.statusCode).toBe(200);
    const [[host, path, headers, body]] = post.mock.calls;
    expect([host, path, headers['apns-topic'], headers['apns-collapse-id']]).toEqual(['production', `/3/device/${TOKEN}`, TOPIC, '0123456789abcdef']);
    expect(JSON.parse(body)).toEqual({
      aps: { alert: { body: 'New on your Mac' }, sound: 'default', 'mutable-content': 1, 'thread-id': '0123456789abcdef' },
      sealed: SEALED,
    });
  });

  it('is not there on a server that relays for no app', async () => {
    const { send } = await start({ relayTopic: '' });
    expect((await send(relayed())).statusCode).toBe(404);
  });

  it("delivers to no other app than the one it relays for", async () => {
    const { post, send } = await start();
    expect((await send(relayed({ topic: 'com.someone.else' }))).statusCode).toBe(403);
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    ['a token that is not 64 hex', { token: 'zz' }],
    ['no sealed notification', { sealed: undefined }],
    ['a sealed notification that is not base64', { sealed: 'not base64!' }],
    ['a sealed notification too big for Apple', { sealed: 'A'.repeat(3004) }],
    ['a thread that is not 16 hex', { thread: 'abc' }],
    ['no words for a notification the phone cannot open', { hidden: '' }],
    ['words too long', { hidden: 'x'.repeat(121) }],
  ])('refuses %s', async (_name, o) => {
    const { post, send } = await start();
    expect((await send(relayed(o))).statusCode).toBe(400);
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    ['410 when Apple says the device is gone', () => ({ status: 410 }), 410],
    ['502 when Apple does not take it', () => ({ status: 500, reason: 'InternalServerError' }), 502],
  ])('answers %s', async (_name, answer, status) => {
    const { send } = await start({ answer });
    expect((await send(relayed())).statusCode).toBe(status);
  });

  it('takes 30 a minute for one device, then says when to try again', async () => {
    let t = 1_000_000;
    const { post, send } = await start({ at: () => t });
    for (let i = 0; i < 30; i++) expect((await send(relayed())).statusCode).toBe(200);
    const over = await send(relayed());
    expect(over.statusCode).toBe(429);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    expect((await send(relayed({ token: 'e'.repeat(64) }))).statusCode).toBe(200);
    t += 60_000;
    expect((await send(relayed())).statusCode).toBe(200);
    expect(post).toHaveBeenCalledTimes(32);
  });

  it('takes 600 a minute in all', async () => {
    const { send } = await start({ at: () => 5_000_000 });
    for (let i = 0; i < 600; i++) expect((await send(relayed({ token: i.toString(16).padStart(64, '0') }))).statusCode).toBe(200);
    expect((await send(relayed({ token: 'a'.repeat(64) }))).statusCode).toBe(429);
  });

  it('logs neither the device nor what it carries', async () => {
    const { send, log } = await start({ answer: () => ({ status: 500 }) });
    await send(relayed());
    await send(relayed({ topic: 'com.someone.else' }));
    expect(log()).not.toContain(TOKEN);
    expect(log()).not.toContain(SEALED.slice(0, 20));
  });
});
