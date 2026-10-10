import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../../../../src/http/app.js';
import { Journal } from '../../../../src/journal/index.js';
import type { LocalMachine } from '../../../../src/sessions/machine.js';
import { REDACT } from '../../../../src/system/log.js';
import { Store } from '../../../../src/system/store.js';
import { addUser, ORIGIN, PASSWORD, RP_ID } from '../../../helpers/app.js';

// The app signs in with a token it sends itself in a header. A browser never sends that header on its own,
// so a request carrying it needs no Origin; the cookie, which a browser does send on its own, still does.

const machine = {
  id: 'local',
  watch: () => () => {},
  onChange: () => () => {},
  listSessions: async () => [],
  createSession: async () => ({ id: 'x' }),
  journal: new Journal({ file: ':memory:', log: () => {} }),
} as unknown as LocalMachine;

let app: FastifyInstance;
let base = '';
let wsBase = '';

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ts-bearer-'));
  const store = new Store(join(dir, 'state.json'));
  await addUser(store);
  ({ app } = await buildApp({ store, machine, origin: ORIGIN, rpId: RP_ID, auditPath: join(dir, 'audit.log') }));
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  base = address;
  wsBase = address.replace(/^http/, 'ws');
});

afterAll(() => app.close());

const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
  fetch(base + path, {
    method: init.method ?? 'GET',
    headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

let ip = 0;
// Each sign-in from its own address, so the lockout one test provokes does not leak into the next.
const freshIp = () => `10.0.0.${++ip}`;

const tokenLogin = (password = PASSWORD, from = freshIp()) =>
  call('/api/auth/token', { method: 'POST', body: { username: 'alice', password }, headers: { 'cf-connecting-ip': from } });

const newToken = async () => {
  const res = await tokenLogin();
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
};

const cookieLogin = async () => {
  const res = await call('/api/auth/password', {
    method: 'POST',
    body: { username: 'alice', password: PASSWORD },
    headers: { origin: ORIGIN, 'cf-connecting-ip': freshIp() },
  });
  expect(res.status).toBe(204);
  return res.headers.get('set-cookie')!.split(';')[0];
};

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('POST /api/auth/token', () => {
  it('answers a token in the body, sets no cookie, and needs no Origin', async () => {
    const res = await tokenLogin();
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    const { token } = (await res.json()) as { token: string };
    expect(token).toMatch(/^\S{20,}$/);
  });

  it('refuses a wrong password', async () => {
    expect((await tokenLogin('wrong')).status).toBe(401);
  });

  it('counts wrong passwords toward the same lockout as the cookie sign-in', async () => {
    const from = freshIp();
    for (let i = 0; i < 5; i++) expect((await tokenLogin('wrong', from)).status).toBe(401);
    const res = await call('/api/auth/password', {
      method: 'POST',
      body: { username: 'alice', password: PASSWORD },
      headers: { origin: ORIGIN, 'cf-connecting-ip': from },
    });
    expect(res.status).toBe(429);
  });

  describe('with the request log', () => {
    it('never writes the token down', () => {
      expect(REDACT).toContain('req.headers.authorization');
    });
  });
});

describe('Guard', () => {
  describe('a request signed with the token', () => {
    it('reads without an Origin', async () => {
      const token = await newToken();
      expect((await call('/api/me', { headers: bearer(token) })).status).toBe(200);
    });

    it('writes without an Origin', async () => {
      const token = await newToken();
      const res = await call('/api/m/local/sessions', { method: 'POST', body: { kind: 'shell' }, headers: bearer(token) });
      expect(res.status).toBeLessThan(300);
    });

    it('shows up among the devices signed in, as the current one', async () => {
      const token = await newToken();
      const list = (await (await call('/api/auth/logins', { headers: bearer(token) })).json()) as { current: boolean }[];
      expect(list.filter((l) => l.current)).toHaveLength(1);
    });

    it('is refused once the token is signed out, and signing out needs no Origin', async () => {
      const token = await newToken();
      expect((await call('/api/auth/logout', { method: 'POST', headers: bearer(token) })).status).toBe(204);
      expect((await call('/api/me', { headers: bearer(token) })).status).toBe(401);
    });
  });

  describe('with a cookie, which keeps its Origin check', () => {
    it('refuses a write by cookie with no Origin', async () => {
      const cookie = await cookieLogin();
      expect((await call('/api/m/local/sessions', { method: 'POST', body: { kind: 'shell' }, headers: { cookie } })).status).toBe(403);
    });

    // Otherwise any made-up token would switch the Origin check off while the cookie signs the request in.
    it('ignores the cookie when a token is sent, so a made-up token next to a good cookie gets nowhere', async () => {
      const cookie = await cookieLogin();
      const forged = { cookie, authorization: 'Bearer made-up' };
      expect((await call('/api/me', { headers: forged })).status).toBe(401);
      expect((await call('/api/m/local/sessions', { method: 'POST', body: { kind: 'shell' }, headers: forged })).status).toBe(401);
    });

    it('still refuses a cookie sign-in with no Origin', async () => {
      const res = await call('/api/auth/password', { method: 'POST', body: { username: 'alice', password: PASSWORD } });
      expect(res.status).toBe(403);
    });
  });

  describe('a socket opened with the token', () => {
    const open = (path: string, headers: Record<string, string>) => {
      const ws = new WebSocket(wsBase + path, { headers });
      const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
      const opened = new Promise<boolean>((r) => {
        ws.on('open', () => r(true));
        ws.on('close', () => r(false));
      });
      return { ws, opened, closed };
    };
    const within = (p: Promise<number>, ms: number) => Promise.race([p, new Promise<number>((r) => setTimeout(() => r(-1), ms))]);

    it('opens without an Origin and closes when the token is signed out', async () => {
      const token = await newToken();
      const events = open('/api/events', bearer(token));
      expect(await events.opened).toBe(true);
      await call('/api/auth/logout', { method: 'POST', headers: bearer(token) });
      expect(await within(events.closed, 3000)).toBe(4401);
    });

    it('is closed 4401 for a made-up token, even next to a good cookie', async () => {
      const cookie = await cookieLogin();
      const events = open('/api/events', { cookie, authorization: 'Bearer made-up' });
      expect(await within(events.closed, 3000)).toBe(4401);
    });

    it('is still closed 4403 for a cookie with no Origin', async () => {
      const cookie = await cookieLogin();
      const events = open('/api/events', { cookie });
      expect(await within(events.closed, 3000)).toBe(4403);
    });
  });
});
