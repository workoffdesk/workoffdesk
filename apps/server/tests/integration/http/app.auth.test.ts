import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Store } from '../../../src/system/store.js';
import { PASSWORD } from '../../helpers/app.js';
import { liveServer } from '../../helpers/server.js';

const live = liveServer('au');
const { dir, auditPath, api, login, openWs } = live;

describe('/api/auth', () => {
  it('rejects API calls without a session cookie', async () => {
    const r = await api('/api/m/local/sessions');
    expect(r.status).toBe(401);
  });

  it('closes a websocket without a session cookie with 4401', async () => {
    const c = openWs('/api/events', { cookie: '' });
    expect(await c.closed).toBe(4401);
  });

  it('logs in with the right password and sets a strict http-only cookie', async () => {
    const r = await login();
    expect(r.status).toBe(204);
    const set = r.headers.get('set-cookie') ?? '';
    expect(set).toMatch(/^wod_session=[A-Za-z0-9_-]{43};/);
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Strict/);
    expect(set).toMatch(/Secure/);
    live.cookie = set.split(';')[0];
    const me = await api('/api/me');
    expect(await me.json()).toEqual({ username: 'alice' });
  });

  it('rejects a wrong username even with the right password', async () => {
    const r = await api('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ username: 'eve', password: PASSWORD }),
      headers: { 'cf-connecting-ip': '8.8.8.1', cookie: 'x=y' },
    });
    expect(r.status).toBe(401);
  });

  it('rejects state-changing requests from another origin', async () => {
    const r = await api('/api/m/local/sessions', {
      method: 'POST',
      body: JSON.stringify({ kind: 'shell' }),
      origin: 'https://evil.test',
    });
    expect(r.status).toBe(403);
    const r2 = await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell' }), origin: null });
    expect(r2.status).toBe(403);
  });

  it('refuses a cross-origin login or logout', async () => {
    const r = await api('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: PASSWORD }),
      headers: { 'cf-connecting-ip': '8.8.8.2' },
      origin: 'https://evil.test',
    });
    expect(r.status).toBe(403);
    expect(r.headers.get('set-cookie')).toBeNull();
    const out = await api('/api/auth/logout', { method: 'POST', origin: 'https://evil.test' });
    expect(out.status).toBe(403);
    expect((await api('/api/me')).status).toBe(200);
  });

  it('closes a cross-origin websocket with 4403 even with a valid cookie', async () => {
    const c = openWs('/api/events', { origin: 'https://evil.test' });
    expect(await c.closed).toBe(4403);
  });

  it('locks an IP after 5 failures and audits every attempt', async () => {
    const before = readFileSync(auditPath, 'utf8').split('\n').filter(Boolean).length;
    for (let i = 0; i < 5; i++) expect((await login('wrong', '6.6.6.6')).status).toBe(401);
    const r = await login(PASSWORD, '6.6.6.6');
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    const lines = readFileSync(auditPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.length - before).toBe(6);
    expect(lines.at(-1)).toMatchObject({ ip: '6.6.6.6', method: 'password', ok: false });
  });

  it('lists and revokes logins by public handle', async () => {
    const second = (await login()).headers.get('set-cookie')!.split(';')[0];
    const list = await (await api('/api/auth/logins')).json();
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(list)).not.toContain(second.split('=')[1]);
    const other = list.find((l: any) => !l.current);
    expect((await api(`/api/auth/logins/${other.handle}`, { method: 'DELETE' })).status).toBe(204);
    expect((await api('/api/me', { headers: { cookie: second } })).status).toBe(401);
  });

  describe('when a login ends', () => {
    const newLogin = async () => (await login()).headers.get('set-cookie')!.split(';')[0];
    const handleOf = async (c: string) =>
      (await (await api('/api/auth/logins', { headers: { cookie: c } })).json()).find((l: any) => l.current).handle;
    const within = (p: Promise<number>, ms: number) =>
      Promise.race([p, new Promise<number>((r) => setTimeout(() => r(-1), ms))]);

    beforeAll(async () => {
      if (!live.cookie) live.cookie = await newLogin();
    });

    it('closes the terminal and the event stream of a device revoked from another one', async () => {
      const victim = await newLogin();
      const { id } = await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell' }) })).json();
      const term = openWs(`/api/m/local/sessions/${id}/ws`, { cookie: victim });
      const events = openWs('/api/events', { cookie: victim });
      await Promise.all([term.opened, events.opened]);
      const handle = await handleOf(victim);
      expect((await api(`/api/auth/logins/${handle}`, { method: 'DELETE' })).status).toBe(204);
      expect(await within(term.closed, 300)).toBe(4401);
      expect(await within(events.closed, 300)).toBe(4401);
      await api(`/api/m/local/sessions/${id}`, { method: 'DELETE' });
    });

    it('closes the sockets of a device that logs out', async () => {
      const victim = await newLogin();
      const events = openWs('/api/events', { cookie: victim });
      await events.opened;
      await api('/api/auth/logout', { method: 'POST', headers: { cookie: victim } });
      expect(await within(events.closed, 300)).toBe(4401);
    });

    it('closes the sockets of a login removed by another process, such as workoffdesk setup', async () => {
      const victim = await newLogin();
      const events = openWs('/api/events', { cookie: victim });
      await events.opened;
      const victimId = victim.split('=')[1];
      new Store(join(dir, 'state.json')).update((s) => {
        s.logins = s.logins.filter((l) => l.id !== victimId);
      });
      expect(await within(events.closed, 4000)).toBe(4401);
      expect((await api('/api/me')).status).toBe(200);
    });
  });
});
