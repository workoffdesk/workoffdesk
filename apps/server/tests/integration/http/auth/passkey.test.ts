import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/http/app.js';
import { ChallengeStore, registerPasskeyRoutes } from '../../../../src/http/auth/passkey.js';
import { LocalMachine } from '../../../../src/sessions/machine.js';
import { Store } from '../../../../src/system/store.js';
import { Tmux } from '../../../../src/system/tmux.js';
import { addUser, ORIGIN, PASSWORD, RP_ID } from '../../../helpers/app.js';

describe('ChallengeStore', () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it('accepts a challenge once, for its own purpose only', () => {
    const c = clock();
    const s = new ChallengeStore(c.now);
    s.add('abc', 'login');
    expect(s.consume('abc', 'login')).toBe(true);
    expect(s.consume('abc', 'login')).toBe(false);
    s.add('def', 'login');
    expect(s.consume('def', 'register')).toBe(false);
    expect(s.consume('def', 'login')).toBe(false);
    expect(s.consume('never-issued', 'login')).toBe(false);
  });

  it('expires challenges after 5 minutes', () => {
    const c = clock();
    const s = new ChallengeStore(c.now);
    s.add('abc', 'login');
    c.advance(5 * 60_000 + 1);
    expect(s.consume('abc', 'login')).toBe(false);
  });

  it('keeps at most 100 outstanding challenges', () => {
    const s = new ChallengeStore();
    for (let i = 0; i < 150; i++) s.add(`c${i}`, 'login');
    expect(s.consume('c0', 'login')).toBe(false);
    expect(s.consume('c149', 'login')).toBe(true);
  });
});

const dir = mkdtempSync(join(tmpdir(), 'ts-pk-'));
const store = new Store(join(dir, 'state.json'));
let base = '';
let close = async () => {};

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  await addUser(store);
  const machine = new LocalMachine({ tmux: new Tmux({ socket: `unused-${process.pid}`, conf: '/dev/null' }), store, claudeSettingsPath: '/dev/null' });
  const { app } = await buildApp({
    store,
    machine,
    origin: ORIGIN,
    rpId: RP_ID,
    auditPath: join(dir, 'audit.log'),
    extend: (a, ctx) => registerPasskeyRoutes(a, ctx, { store, origin: ORIGIN, rpId: RP_ID }),
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  close = () => app.close();
});

afterAll(() => close());

describe('registerPasskeyRoutes', () => {
  it('refuses registration without a login', async () => {
    expect((await post('/api/auth/passkey/register/options', {})).status).toBe(401);
    expect((await post('/api/auth/passkey/register/verify', {})).status).toBe(401);
  });

  it('issues login options that require user verification and a discoverable credential', async () => {
    const r = await post('/api/auth/passkey/login/options', {});
    expect(r.status).toBe(200);
    const o = await r.json();
    expect(o.rpId).toBe('workoffdesk.example.test');
    expect(o.userVerification).toBe('required');
    expect(o.allowCredentials ?? []).toEqual([]);
    expect(o.challenge).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it('refuses cross-origin passkey login', async () => {
    expect((await post('/api/auth/passkey/login/options', {}, { origin: 'https://evil.test' })).status).toBe(403);
  });

  it('rejects an unknown credential without a cookie', async () => {
    const r = await post('/api/auth/passkey/login/verify', { response: { id: 'nope', rawId: 'nope', type: 'public-key', response: {} } });
    expect(r.status).toBe(401);
    expect(r.headers.get('set-cookie')).toBeNull();
  });

  it('turns away a passkey login or registration that carries no response at all', async () => {
    const login = await post('/api/auth/passkey/login/verify', {});
    expect(login.status).toBe(401);
    expect(login.headers.get('set-cookie')).toBeNull();
    const signedIn = await post('/api/auth/password', { username: 'alice', password: PASSWORD }, { 'cf-connecting-ip': '10.8.0.1' });
    const cookie = signedIn.headers.get('set-cookie')!.split(';')[0];
    expect((await post('/api/auth/passkey/register/verify', {}, { cookie })).status).toBe(400);
  });

  it('keeps passkey login open while password login is globally locked', async () => {
    for (let i = 0; i < 20; i++) {
      await post('/api/auth/password', { username: 'alice', password: 'wrong' }, { 'cf-connecting-ip': `10.9.0.${i}` });
    }
    const locked = await post('/api/auth/password', { username: 'alice', password: PASSWORD }, { 'cf-connecting-ip': '10.9.1.1' });
    expect(locked.status).toBe(429);
    expect((await post('/api/auth/passkey/login/options', {})).status).toBe(200);
  });
});
