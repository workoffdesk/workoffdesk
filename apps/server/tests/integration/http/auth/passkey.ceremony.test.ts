import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/http/app.js';
import { hashPassword } from '../../../../src/http/auth/password.js';
import { registerPasskeyRoutes } from '../../../../src/http/auth/passkey.js';
import { LocalMachine } from '../../../../src/sessions/machine.js';
import { Store } from '../../../../src/system/store.js';
import { Tmux } from '../../../../src/system/tmux.js';
import { Authenticator } from '../../../helpers/authenticator.js';
import { ORIGIN, PASSWORD, RP_ID } from '../../../helpers/app.js';

// Passkeys made and used end to end, with an authenticator in software answering the options the server sends.
const dir = mkdtempSync(join(tmpdir(), 'ts-pkc-'));
const auditPath = join(dir, 'audit.log');
const store = new Store(join(dir, 'state.json'));
let t = 1_700_000_000_000;
let base = '';
let close = async () => {};
let cookie = '';

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, {
    method,
    headers: { origin: ORIGIN, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => call('POST', path, body, headers);
const options = async (purpose: 'register' | 'login', origin = ORIGIN) => {
  const r = await post(`/api/auth/passkey/${purpose}/options`, {}, purpose === 'register' ? { cookie } : {});
  expect(r.status).toBe(200);
  return { origin, rpId: RP_ID, challenge: ((await r.json()) as { challenge: string }).challenge };
};
const register = async (a: Authenticator, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  post('/api/auth/passkey/register/verify', { response: a.register(await options('register')), ...body }, { cookie, ...headers });
const login = async (a: Authenticator) => post('/api/auth/passkey/login/verify', { response: a.login(await options('login')) });
const audited = () =>
  readFileSync(auditPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { method: string; ok: boolean });

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
    auditPath,
    extend: (a, ctx) => registerPasskeyRoutes(a, ctx, { store, now: () => t }),
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  close = () => app.close();
  const r = await post('/api/auth/password', { username: 'someone', password: PASSWORD }, { 'cf-connecting-ip': '10.8.0.1' });
  cookie = r.headers.get('set-cookie')!.split(';')[0];
});

afterAll(() => close());

beforeEach(() => {
  store.update((s) => {
    s.passkeys = [];
  });
});

describe('registerPasskeyRoutes', () => {
  describe('registering a passkey', () => {
    it('keeps its key, counter and transports, under the name given, trimmed and cut to 40', async () => {
      const a = new Authenticator();
      t += 1000;
      const r = await register(a, { name: `  ${'x'.repeat(50)}  ` });
      expect(r.status).toBe(201);
      expect(await r.json()).toEqual({ id: a.id, name: 'x'.repeat(40) });
      expect(store.get().passkeys).toEqual([
        { id: a.id, publicKey: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/), counter: 0, transports: ['internal'], name: 'x'.repeat(40), createdAt: t },
      ]);
    });

    it.each([
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone'],
      ['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 'iPad'],
      ['Mozilla/5.0 (Linux; Android 15; Pixel 9)', 'Android'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'Mac'],
      ['curl/8.7.1', 'Device'],
    ])('names it for the device it was made on when no name is given (%s)', async (ua, name) => {
      for (const given of [undefined, '   ', 42]) {
        const r = await register(new Authenticator(), given === undefined ? {} : { name: given }, { 'user-agent': ua });
        expect(((await r.json()) as { name: string }).name).toBe(name);
      }
    });

    it('asks the authenticator not to make a second passkey for one already kept', async () => {
      const a = new Authenticator();
      await register(a);
      const r = await post('/api/auth/passkey/register/options', {}, { cookie });
      const o = (await r.json()) as PublicKeyCredentialCreationOptionsJSON;
      expect(o.excludeCredentials).toEqual([{ id: a.id, type: 'public-key', transports: ['internal'] }]);
      expect(o.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
      expect(o.attestation).toBe('none');
      expect(o.rp).toEqual({ name: 'WorkOffDesk', id: RP_ID });
      expect(o.user.name).toBe('someone');
    });

    it('keeps one passkey per credential when the same one is registered again', async () => {
      const a = new Authenticator();
      await register(a, { name: 'first' });
      expect((await register(a, { name: 'again' })).status).toBe(201);
      expect(store.get().passkeys.map((p) => p.name)).toEqual(['again']);
    });

    it.each<[string, (a: Authenticator) => Promise<Response>]>([
      ['answers a challenge that was already used', async (a) => {
        const response = a.register(await options('register'));
        await post('/api/auth/passkey/register/verify', { response }, { cookie });
        store.update((s) => {
          s.passkeys = [];
        });
        return post('/api/auth/passkey/register/verify', { response }, { cookie });
      }],
      ['answers a challenge given out for a login', async (a) => post('/api/auth/passkey/register/verify', { response: a.register(await options('login')) }, { cookie })],
      ['answers a challenge the server never gave out', async (a) => post('/api/auth/passkey/register/verify', { response: a.register({ origin: ORIGIN, rpId: RP_ID, challenge: 'bm90LWdpdmVuLW91dA' }) }, { cookie })],
      ['was made for another site', async (a) => post('/api/auth/passkey/register/verify', { response: a.register({ ...(await options('register')), origin: 'https://evil.test' }) }, { cookie })],
      ['was made for another relying party', async (a) => post('/api/auth/passkey/register/verify', { response: a.register({ ...(await options('register')), rpId: 'evil.test' }) }, { cookie })],
      ['did not verify the user', async (a) => post('/api/auth/passkey/register/verify', { response: a.register({ ...(await options('register')), noUv: true }) }, { cookie })],
      ['is not a registration at all', async (a) => post('/api/auth/passkey/register/verify', { response: { id: a.id, rawId: a.id, type: 'public-key', response: {} } }, { cookie })],
    ])('turns away a passkey that %s, and keeps nothing', async (_, attempt) => {
      const r = await attempt(new Authenticator());
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: 'registration failed' });
      expect(store.get().passkeys).toEqual([]);
    });
  });

  describe('signing in with a passkey', () => {
    it('signs in, moves the counter on, notes when it was used, and audits it', async () => {
      const a = new Authenticator();
      await register(a);
      const before = audited().length;
      const logins = store.get().logins.length;
      t += 5000;
      const r = await login(a);
      expect(r.status).toBe(204);
      const session = r.headers.get('set-cookie')!.split(';')[0];
      expect((await call('GET', '/api/auth/passkeys', undefined, { cookie: session })).status).toBe(200);
      expect(store.get().passkeys[0]).toMatchObject({ counter: 1, lastUsedAt: t });
      expect(store.get().logins.slice(logins).map((l) => l.method)).toEqual(['passkey']);
      expect(audited().slice(before)).toMatchObject([{ method: 'passkey', ok: true }]);
    });

    it.each<[string, (a: Authenticator) => Promise<Response>]>([
      ['a forged key under its id', async (a) => login(a.forged())],
      ['a copy whose counter has fallen behind', async (a) => {
        const copy = a.copied();
        expect((await login(a)).status).toBe(204);
        return login(copy);
      }],
      ['an answer replayed', async (a) => {
        const response = a.login(await options('login'));
        expect((await post('/api/auth/passkey/login/verify', { response })).status).toBe(204);
        return post('/api/auth/passkey/login/verify', { response });
      }],
      ['a challenge given out for registering', async (a) => post('/api/auth/passkey/login/verify', { response: a.login(await options('register')) })],
      ['an answer made for another site', async (a) => post('/api/auth/passkey/login/verify', { response: a.login({ ...(await options('login')), origin: 'https://evil.test' }) })],
      ['no user verification', async (a) => post('/api/auth/passkey/login/verify', { response: a.login({ ...(await options('login')), noUv: true }) })],
      ['a passkey that was removed', async (a) => {
        expect((await call('DELETE', `/api/auth/passkeys/${encodeURIComponent(a.id)}`, undefined, { cookie })).status).toBe(204);
        return login(a);
      }],
    ])('turns away %s, with no cookie, and audits it', async (_, attempt) => {
      const a = new Authenticator();
      await register(a);
      const counter = () => store.get().passkeys.find((p) => p.id === a.id)?.counter;
      const before = audited().length;
      const r = await attempt(a);
      const kept = counter();
      expect(r.status).toBe(401);
      expect(r.headers.get('set-cookie')).toBeNull();
      expect(audited().slice(-1)).toMatchObject([{ method: 'passkey', ok: false }]);
      expect(audited().length).toBeGreaterThan(before);
      expect(counter()).toBe(kept);
    });

    it('turns away an answer sent from another origin before looking at it', async () => {
      const a = new Authenticator();
      await register(a);
      const before = audited().length;
      const r = await post('/api/auth/passkey/login/verify', { response: a.login(await options('login')) }, { origin: 'https://evil.test' });
      expect(r.status).toBe(403);
      expect(audited()).toHaveLength(before);
      expect(store.get().passkeys[0].counter).toBe(0);
    });
  });

  describe('the passkeys kept', () => {
    it('lists them with when each was made and last used, and only to someone signed in', async () => {
      const a = new Authenticator();
      const b = new Authenticator();
      t += 1000;
      await register(a, { name: 'phone' });
      const made = t;
      t += 1000;
      await register(b, { name: 'laptop' });
      t += 1000;
      await login(a);
      expect((await call('GET', '/api/auth/passkeys')).status).toBe(401);
      expect(await (await call('GET', '/api/auth/passkeys', undefined, { cookie })).json()).toEqual([
        { id: a.id, name: 'phone', createdAt: made, lastUsedAt: t },
        { id: b.id, name: 'laptop', createdAt: made + 1000, lastUsedAt: null },
      ]);
    });

    it('removes them one at a time, for someone signed in, and finds no unknown one', async () => {
      const a = new Authenticator();
      const b = new Authenticator();
      await register(a);
      await register(b);
      const del = (id: string, headers: Record<string, string> = { cookie }) => call('DELETE', `/api/auth/passkeys/${encodeURIComponent(id)}`, undefined, headers);
      expect((await del(a.id, {})).status).toBe(401);
      expect((await del('nope')).status).toBe(404);
      expect(store.get().passkeys).toHaveLength(2);
      expect((await del(a.id)).status).toBe(204);
      expect(store.get().passkeys.map((p) => p.id)).toEqual([b.id]);
      expect((await del(a.id)).status).toBe(404);
    });
  });
});
