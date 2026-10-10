import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../../../src/http/app.js';
import { createLogger } from '../../../src/system/log.js';
import { LocalMachine } from '../../../src/sessions/machine.js';
import { Tmux } from '../../../src/system/tmux.js';
import { ORIGIN, RP_ID } from '../../helpers/app.js';
import { liveServer } from '../../helpers/server.js';

const live = liveServer('a', { signedIn: true });
const { tmux, socket: SOCKET, conf, store, auditPath, start, api } = live;

describe('buildApp', () => {
  it('sends security headers', async () => {
    const r = await api('/api/me');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('returns 404 for unknown api paths and machines', async () => {
    expect((await api('/api/nope')).status).toBe(404);
    expect((await api('/api/m/other/sessions')).status).toBe(404);
  });

  it('leaves watching the machine to whoever runs it, so tmux is polled once', async () => {
    const machine = new LocalMachine({ tmux, store, claudeSettingsPath: '/dev/null', shell: '/bin/sh' });
    let watches = 0;
    const watch = machine.watch.bind(machine);
    machine.watch = (ms) => {
      watches++;
      return watch(ms);
    };
    const { app } = await buildApp({ store, machine, origin: ORIGIN, rpId: RP_ID, auditPath });
    await app.ready();
    await app.close();
    expect(watches).toBe(0);
  });

  it('records requests that failed or were slow, with their route rather than their raw URL, and nothing else', async () => {
    const machine = new LocalMachine({ tmux, store, claudeSettingsPath: '/dev/null', shell: '/bin/sh' });
    const file = join(mkdtempSync(join(tmpdir(), 'ts-reqlog-')), 'workoffdesk.log');
    const { app } = await buildApp({
      store,
      machine,
      origin: ORIGIN,
      rpId: RP_ID,
      auditPath,
      logger: createLogger({ file }),
      extend: (a) => {
        a.get('/ok', { config: { public: true } }, async () => 'ok');
        a.get('/slow', { config: { public: true } }, async () => new Promise((r) => setTimeout(() => r('late'), 1100)));
      },
    });
    await app.inject({ url: '/ok' });
    await app.inject({ url: '/slow' });
    await app.inject({ method: 'DELETE', url: '/api/m/local/sessions/abc?token=1' });
    await app.close();
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const requests = lines.filter((l) => l.status);
    expect(requests.map((l) => [l.method, l.url, l.status])).toEqual([
      ['GET', '/slow', 200],
      ['DELETE', '/api/m/:machine/sessions/:id', 403],
    ]);
    expect(requests[0].ms).toBeGreaterThanOrEqual(1000);
    expect(JSON.stringify(lines)).not.toContain('token=1');
  });

  // A page or app on older code tells from any answer that the server has moved on.
  it.each([
    ['an answer', '/api/sessions', { cookie: '' }],
    ['a refusal', '/api/m/local/sessions', {}],
    ['a public route', '/healthz', {}],
  ])('names its release on %s', async (_, path, headers) => {
    const r = await fetch(`${live.server.base}${path}`, { headers });
    expect(r.headers.get('x-workoffdesk-version')).toBe(JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')).version);
  });

  describe('when it closes', () => {
    const within = (p: Promise<number>, ms: number) =>
      Promise.race([p, new Promise<number>((r) => setTimeout(() => r(-1), ms))]);

    // 4012 is "restarting": the phone takes it as a cue to come back soon, not as a dropped line.
    it('tells every open socket, terminal and event stream alike, that the server is restarting', async () => {
      const { id } = await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell' }) })).json();
      const own = await start();
      const open = (path: string) => {
        const ws = new WebSocket(own.wsBase + path, { headers: { origin: ORIGIN, cookie: live.cookie } });
        const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)));
        return { opened: new Promise((r) => ws.once('open', r)), closed };
      };
      const events = open('/api/events');
      const term = open(`/api/m/local/sessions/${id}/ws`);
      await Promise.all([events.opened, term.opened]);
      await own.close();
      expect(await within(events.closed, 5000)).toBe(4012);
      expect(await within(term.closed, 5000)).toBe(4012);
    });
  });
});

describe('GET /healthz', () => {
  it('says it is alive without a login, and nothing more', async () => {
    const r = await fetch(`${live.server.base}/healthz`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Object.keys(body).sort()).toEqual(['ok', 'version']);
    expect(body.ok).toBe(true);
    expect(body.version).toBe(JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')).version);
  });

  it('answers 503 when tmux does not', async () => {
    const broken = new Tmux({ socket: SOCKET, conf, bin: '/usr/bin/false' });
    const machine = new LocalMachine({ tmux: broken, store, claudeSettingsPath: '/dev/null', shell: '/bin/sh' });
    const { app } = await buildApp({ store, machine, origin: ORIGIN, rpId: RP_ID, auditPath });
    const r = await app.inject({ url: '/healthz' });
    await app.close();
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ ok: false });
  });

  // It needs no login and sits on the public address, so a flood of it must not become a flood of tmux.
  it('runs one tmux check for many requests at once, and checks again once that one is done', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-health-'));
    const log = join(dir, 'calls');
    const bin = join(dir, 'tmux');
    writeFileSync(bin, `#!/bin/sh\necho "$*" >> ${log}\nsleep 0.3\n`);
    chmodSync(bin, 0o755);
    const machine = new LocalMachine({ tmux: new Tmux({ socket: SOCKET, conf, bin }), store, claudeSettingsPath: '/dev/null', shell: '/bin/sh' });
    const { app } = await buildApp({ store, machine, origin: ORIGIN, rpId: RP_ID, auditPath });
    const calls = () => readFileSync(log, 'utf8').trim().split('\n').filter((l) => l.includes(' list-sessions ')).length;
    try {
      const first = await Promise.all(Array.from({ length: 20 }, () => app.inject({ url: '/healthz' })));
      expect(first.every((r) => r.statusCode === 200), 'precondition: the fake tmux answers').toBe(true);
      expect(calls()).toBe(1);
      await app.inject({ url: '/healthz' });
      expect(calls()).toBe(2);
    } finally {
      await app.close();
    }
  });
});
