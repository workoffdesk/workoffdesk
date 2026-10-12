import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/http/app.js';
import { Guard } from '../../../../src/http/auth/guard.js';
import { hashPassword } from '../../../../src/http/auth/password.js';
import { registerPasskeyRoutes } from '../../../../src/http/auth/passkey.js';
import { LoginSessions } from '../../../../src/http/auth/sessions.js';
import { LocalMachine } from '../../../../src/sessions/machine.js';
import { sites } from '../../../../src/system/config.js';
import { Store } from '../../../../src/system/store.js';
import { Tmux } from '../../../../src/system/tmux.js';
import { Authenticator } from '../../../helpers/authenticator.js';
import { ORIGIN, PASSWORD, RP_ID } from '../../../helpers/app.js';

// One install reached at two addresses: the browser is trusted on each, and passkeys follow the page's address.
const EXTRA = 'https://relay.example.net';
const OTHER = 'https://evil.test';
const dir = mkdtempSync(join(tmpdir(), 'ts-xo-'));
const store = new Store(join(dir, 'state.json'));
let base = '';
let close = async () => {};

const post = (path: string, origin: string | null, body: unknown = {}, headers: Record<string, string> = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
let ip = 0;
const signIn = (origin: string | null) => post('/api/auth/password', origin, { username: 'someone', password: PASSWORD }, { 'cf-connecting-ip': `10.9.0.${++ip}` });
const cookieFrom = async (origin: string) => (await signIn(origin)).headers.get('set-cookie')!.split(';')[0];

beforeAll(async () => {
  const hash = await hashPassword(PASSWORD);
  store.update((s) => {
    s.user = { username: 'someone', hash };
  });
  const machine = new LocalMachine({ tmux: new Tmux({ socket: `unused-${process.pid}`, conf: '/dev/null' }), store, claudeSettingsPath: '/dev/null' });
  const { app } = await buildApp({
    store,
    machine,
    origin: ORIGIN,
    rpId: RP_ID,
    extraOrigins: [EXTRA],
    auditPath: join(dir, 'audit.log'),
    extend: (a, ctx) => registerPasskeyRoutes(a, ctx, { store }),
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  close = () => app.close();
});

afterAll(() => close());

describe('an install with extraOrigins', () => {
  it.each([
    ['the origin', ORIGIN, 204],
    ['another configured address', EXTRA, 204],
    ['a site not configured', OTHER, 403],
    ['no Origin at all', null, 403],
  ])('signs in with the password from %s: %s', async (_, origin, status) => {
    expect((await signIn(origin)).status).toBe(status);
  });

  it('takes a write riding on the cookie from the other address, and from nowhere else', async () => {
    const cookie = await cookieFrom(EXTRA);
    for (const origin of [OTHER, null]) expect((await post('/api/auth/logout', origin, {}, { cookie })).status).toBe(403);
    expect((await post('/api/auth/logout', EXTRA, {}, { cookie })).status).toBe(204);
  });

  it('makes and uses a passkey on the other address under that address, and refuses it said to be from the origin', async () => {
    const cookie = await cookieFrom(EXTRA);
    const a = new Authenticator();
    const options = async (purpose: 'register' | 'login', origin: string) => {
      const r = await post(`/api/auth/passkey/${purpose}/options`, origin, {}, purpose === 'register' ? { cookie } : {});
      expect(r.status).toBe(200);
      return (await r.json()) as { challenge: string; rp?: { id: string }; rpId?: string };
    };
    const reg = await options('register', EXTRA);
    expect(reg.rp?.id).toBe('relay.example.net');
    const made = await post('/api/auth/passkey/register/verify', EXTRA, { response: a.register({ origin: EXTRA, rpId: 'relay.example.net', challenge: reg.challenge }) }, { cookie });
    expect(made.status).toBe(201);

    const on = await options('login', EXTRA);
    expect(on.rpId).toBe('relay.example.net');
    const ok = await post('/api/auth/passkey/login/verify', EXTRA, { response: a.login({ origin: EXTRA, rpId: 'relay.example.net', challenge: on.challenge }) });
    expect(ok.status).toBe(204);

    const mixed = await options('login', EXTRA);
    const refused = await post('/api/auth/passkey/login/verify', EXTRA, { response: a.login({ origin: ORIGIN, rpId: 'relay.example.net', challenge: mixed.challenge }) });
    expect(refused.status).toBe(401);
  });

  it("keeps the origin's own passkey domain on the origin", async () => {
    const r = await post('/api/auth/passkey/login/options', ORIGIN);
    expect(((await r.json()) as { rpId: string }).rpId).toBe(RP_ID);
  });
});

describe('Guard with several sites', () => {
  const logins = new LoginSessions(store);
  const guard = new Guard(logins, sites({ origin: ORIGIN, rpId: RP_ID, extraOrigins: [EXTRA] }));
  const req = (origin?: string, cookie?: string) => ({ headers: { ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) } }) as unknown as FastifyRequest;
  const id = () => logins.create('test', 'password');

  it.each([
    [ORIGIN, null],
    [EXTRA, null],
    [OTHER, 4403],
  ])('lets a WebSocket with the cookie in from %s: %s', (origin, code) => {
    expect(guard.wsRejectCode(req(origin, `wod_session=${id()}`))).toBe(code);
  });

  it("gives a request its address's site, and the origin's when the Origin is not one of them", () => {
    expect(guard.siteOf(req(EXTRA))).toEqual({ origin: EXTRA, rpId: 'relay.example.net' });
    expect(guard.siteOf(req(ORIGIN))).toEqual({ origin: ORIGIN, rpId: RP_ID });
    expect(guard.siteOf(req(OTHER))).toEqual({ origin: ORIGIN, rpId: RP_ID });
    expect(guard.siteOf(req())).toEqual({ origin: ORIGIN, rpId: RP_ID });
  });
});
