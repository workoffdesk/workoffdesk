import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '../../../../src/http/auth/password.js';
import { Store } from '../../../../src/system/store.js';
import { buildWizard, type WizardDeps } from '../../../../src/commands/wizard/server.js';
import { PASSWORD } from '../../../helpers/app.js';

const TOKEN = 'a'.repeat(32);
const HOST = '127.0.0.1:5123';
const ORIGIN = `http://${HOST}`;

let app: FastifyInstance;
afterEach(() => app?.close());

async function start(over: Partial<WizardDeps> = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ts-wizard-'));
  const webDir = join(home, 'web');
  mkdirSync(webDir);
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>setup</title>');
  const ran: string[][] = [];
  let done = 0;
  const installed: unknown[] = [];
  const d: WizardDeps = {
    home,
    webDir,
    token: TOKEN,
    host: () => HOST,
    doctor: async () => [{ id: 'tmux', ok: true, detail: '3.5a' }],
    probe: async () => ({ tailscale: { dnsName: 'mac.tail1234.ts.net', running: true }, cloudflared: { tunnels: ['home'] } }),
    run: async (cmd, args) => {
      ran.push([cmd, ...args]);
      return { code: 0, out: '' };
    },
    install: async (o) => {
      installed.push(o);
      return { ok: true, message: 'up' };
    },
    onDone: () => void done++,
    ...over,
  };
  app = await buildWizard(d);
  const call = (method: 'GET' | 'POST', url: string, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method, url, payload, headers: { host: HOST, origin: ORIGIN, 'x-setup-token': TOKEN, ...headers } });
  return { home, call, ran, installed, done: () => done };
}

describe('buildWizard', () => {
  it.each([
    ['without the token', { 'x-setup-token': '' }],
    ['with another token', { 'x-setup-token': 'b'.repeat(32) }],
    ['reached by another name for the host (DNS rebinding)', { host: 'evil.example:5123' }],
  ])('refuses a request %s', async (_, headers) => {
    const { call } = await start();
    expect((await call('GET', '/api/setup/state', undefined, headers)).statusCode).toBe(403);
  });

  it('refuses a write from another page', async () => {
    const { call, home } = await start();
    const r = await call('POST', '/api/setup/account', { username: 'me', password: PASSWORD }, { origin: 'https://evil.example' });
    expect(r.statusCode).toBe(403);
    expect(new Store(join(home, 'state.json')).get().user).toBeUndefined();
  });

  it('serves its page to anyone on this Mac, since the token is what guards the API', async () => {
    const { call } = await start();
    const r = await call('GET', '/setup', undefined, { 'x-setup-token': '' });
    expect([r.statusCode, r.body]).toEqual([200, '<!doctype html><title>setup</title>']);
  });

  it('tells the page what is there: the checks, the user, the address and the ways in', async () => {
    const { call } = await start();
    expect((await call('GET', '/api/setup/state')).json()).toEqual({
      checks: [{ id: 'tmux', ok: true, detail: '3.5a' }],
      user: null,
      origin: null,
      port: 7681,
      qr: null,
      remote: { tailscale: { dnsName: 'mac.tail1234.ts.net', running: true }, cloudflared: { tunnels: ['home'] } },
    });
  });

  it('sets up the user, as setup does, signing every device out', async () => {
    const { call, home } = await start();
    new Store(join(home, 'state.json')).update((s) => {
      s.logins = [{ id: 'x' } as never];
    });
    expect((await call('POST', '/api/setup/account', { username: ' me ', password: PASSWORD })).statusCode).toBe(200);
    const s = new Store(join(home, 'state.json')).get();
    expect(s.user?.username).toBe('me');
    expect(await verifyPassword(PASSWORD, s.user!.hash)).toBe(true);
    expect(s.logins).toEqual([]);
  });

  it.each([
    ['an empty username', { username: ' ', password: PASSWORD }],
    ['a short password', { username: 'me', password: 'short' }],
  ])('refuses %s', async (_, body) => {
    const { call } = await start();
    expect((await call('POST', '/api/setup/account', body)).statusCode).toBe(400);
  });

  it('takes an address typed by hand, and refuses one that is not https', async () => {
    const { call, home } = await start();
    expect((await call('POST', '/api/setup/address', { kind: 'other', origin: 'http://example.com' })).statusCode).toBe(400);
    expect((await call('POST', '/api/setup/address', { kind: 'other', origin: 'https://workoffdesk.example.com' })).statusCode).toBe(200);
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).origin).toBe('https://workoffdesk.example.com');
    expect((await call('GET', '/api/setup/state')).json().qr).toMatch(/^<svg/);
  });

  it("serves the port over Tailscale and takes the Mac's tailnet name for the address", async () => {
    const { call, home, ran } = await start();
    expect((await call('POST', '/api/setup/address', { kind: 'tailscale' })).statusCode).toBe(200);
    expect(ran).toEqual([['tailscale', 'serve', '--bg', '7681']]);
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).origin).toBe('https://mac.tail1234.ts.net');
  });

  it('takes a Cloudflare tunnel it has, and carries it to the service step', async () => {
    const { call, home, installed } = await start();
    expect((await call('POST', '/api/setup/address', { kind: 'cloudflare', tunnel: 'nope', hostname: 'wod.example.com' })).statusCode).toBe(400);
    expect((await call('POST', '/api/setup/address', { kind: 'cloudflare', tunnel: 'home', hostname: 'wod.example.com' })).statusCode).toBe(200);
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).origin).toBe('https://wod.example.com');
    await call('POST', '/api/setup/account', { username: 'me', password: PASSWORD });
    expect((await call('POST', '/api/setup/service', {})).json()).toEqual({ ok: true, message: 'up' });
    expect(installed).toEqual([{ tunnel: 'home' }]);
  });

  it('keeps the port and the passkeys of an address it had when the address stays', async () => {
    const { call, home } = await start();
    writeFileSync(join(home, 'config.json'), JSON.stringify({ origin: 'https://a.example.com', rpId: 'example.com', port: 7700 }));
    await call('POST', '/api/setup/address', { kind: 'other', origin: 'https://a.example.com' });
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))).toMatchObject({ rpId: 'example.com', port: 7700 });
  });

  it('refuses to install a service before there is a user and an address', async () => {
    const { call, home, installed } = await start();
    expect((await call('POST', '/api/setup/service', {})).statusCode).toBe(409);
    await call('POST', '/api/setup/address', { kind: 'other', origin: 'https://wod.example.com' });
    expect((await call('POST', '/api/setup/service', {})).statusCode).toBe(409);
    rmSync(join(home, 'config.json'));
    await call('POST', '/api/setup/account', { username: 'me', password: PASSWORD });
    expect((await call('POST', '/api/setup/service', {})).statusCode).toBe(409);
    await call('POST', '/api/setup/address', { kind: 'other', origin: 'https://wod.example.com' });
    expect((await call('POST', '/api/setup/service', {})).json()).toEqual({ ok: true, message: 'up' });
    expect(installed).toEqual([{}]);
  });

  it('says the tunnel is gone when an address after it is not one', async () => {
    const { call, installed } = await start();
    await call('POST', '/api/setup/account', { username: 'me', password: PASSWORD });
    await call('POST', '/api/setup/address', { kind: 'cloudflare', tunnel: 'home', hostname: 'wod.example.com' });
    await call('POST', '/api/setup/address', { kind: 'other', origin: 'https://wod.example.com' });
    await call('POST', '/api/setup/service', {});
    expect(installed).toEqual([{}]);
  });

  it('refuses Tailscale when it is not running', async () => {
    const { call, ran } = await start({ probe: async () => ({ tailscale: { dnsName: 'mac.tail1234.ts.net', running: false }, cloudflared: null }) });
    expect((await call('POST', '/api/setup/address', { kind: 'tailscale' })).statusCode).toBe(409);
    expect(ran).toEqual([]);
  });

  it('says what tailscale said when serve fails, and keeps the address it had', async () => {
    const { call, home } = await start({ run: async () => ({ code: 1, out: 'serve is not enabled on your tailnet' }) });
    const r = await call('POST', '/api/setup/address', { kind: 'tailscale' });
    expect([r.statusCode, r.json().error]).toEqual([502, expect.stringContaining('serve is not enabled')]);
    expect(() => readFileSync(join(home, 'config.json'))).toThrow();
  });

  it('counts every request as the wizard being used', async () => {
    let touched = 0;
    const { call } = await start({ touch: () => void touched++ });
    await call('GET', '/api/setup/state');
    await call('GET', '/setup');
    expect(touched).toBe(2);
  });

  it('ends when the page says it is done', async () => {
    const { call, done } = await start();
    expect((await call('POST', '/api/setup/done', {})).statusCode).toBe(200);
    expect(done()).toBe(1);
  });
});
