import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/http/app.js';
import { registerPasskeyRoutes } from '../../../../src/http/auth/passkey.js';
import { Journal } from '../../../../src/journal/index.js';
import type { LocalMachine } from '../../../../src/sessions/machine.js';
import { Store } from '../../../../src/system/store.js';
import { ORIGIN, RP_ID } from '../../../helpers/app.js';

const dir = mkdtempSync(join(tmpdir(), 'ts-routes-'));
const webDir = join(dir, 'web');
mkdirSync(join(webDir, 'assets'), { recursive: true });
writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>workoffdesk</title>');
writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log(1)');
writeFileSync(join(webDir, 'assets', 'main-C934z9NI.js'), 'console.log(2)');
writeFileSync(join(webDir, 'sw.js'), 'self');

// Handlers must never run for an anonymous caller, so the machine only has to exist.
const machine = {
  id: 'local',
  watch: () => () => {},
  onChange: () => () => {},
  listSessions: async () => [],
  createSession: async () => ({ id: 'x' }),
  killSession: async () => {},
  exists: async () => true,
  screenText: async () => 'screen',
  journal: new Journal({ file: ':memory:', log: () => {} }),
} as unknown as LocalMachine;

let app: FastifyInstance;

beforeAll(async () => {
  const store = new Store(join(dir, 'state.json'));
  store.update((s) => {
    s.user = { username: 'alice', hash: 'unused' };
    s.vapid = { publicKey: 'pk', privateKey: 'sk' };
  });
  ({ app } = await buildApp({
    store,
    machine,
    origin: ORIGIN,
    rpId: RP_ID,
    auditPath: join(dir, 'audit.log'),
    webDir,
    claudeProjectsRoot: join(dir, 'none'),
    media: { uploadsDir: join(dir, 'uploads') },
    extend: (a, ctx) => {
      registerPasskeyRoutes(a, ctx, { store });
      a.get('/api/added-later', async () => ({ secret: true }));
      a.get('/added-outside-api', async () => ({ secret: true }));
    },
  }));
  await app.ready();
});

afterAll(() => app.close());

const PROTECTED: [string, string][] = [
  ['GET', '/api/me'],
  ['GET', '/api/auth/logins'],
  ['DELETE', '/api/auth/logins/abc'],
  ['GET', '/api/m/local/sessions'],
  ['GET', '/api/m/local/dirs?path=~/'],
  ['POST', '/api/m/local/sessions'],
  ['DELETE', '/api/m/local/sessions/abc'],
  ['GET', '/api/m/local/sessions/abc/screen'],
  ['GET', '/api/m/local/sessions/abc/commands'],
  ['GET', '/api/m/local/sessions/abc/choices'],
  ['POST', '/api/m/local/sessions/abc/choices'],
  ['GET', '/api/m/local/sessions/abc/image?path=/x.png'],
  ['PATCH', '/api/m/local/sessions/abc'],
  ['GET', '/api/claude/recent'],
  ['GET', '/api/claude/projects'],
  ['GET', '/api/push/key'],
  ['POST', '/api/push/subscribe'],
  ['DELETE', '/api/push/subscribe'],
  ['POST', '/api/auth/passkey/register/options'],
  ['POST', '/api/auth/passkey/register/verify'],
  ['GET', '/api/auth/passkeys'],
  ['DELETE', '/api/auth/passkeys/abc'],
  ['POST', '/api/uploads'],
  ['GET', '/api/uploads/2026-10-03-191036-83c3d5.png'],
  ['GET', '/api/added-later'],
  ['GET', '/added-outside-api'],
];

// Different spellings that the router decodes to the same route.
const spellings = (path: string) => [
  path,
  path.replace(/^\/api\//, '/%61pi/'),
  path.replace(/\/([a-z])([a-z-]*)$/, (_m, c: string, rest: string) => `/%${c.charCodeAt(0).toString(16)}${rest}`),
];

// Every route the app has, as Fastify lists them: a tree of path pieces, each with the methods it takes.
const routesOf = (a: FastifyInstance): string[] => {
  const path: string[] = [];
  const routes: string[] = [];
  for (const line of a.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = /^([│ ]*)[├└]── (\S+)(?: \(([^)]+)\))?$/.exec(line);
    if (!m) continue;
    path.length = m[1].length / 4;
    path.push(m[2]);
    for (const method of m[3]?.split(', ') ?? []) routes.push(`${method} ${path.join('')}`);
  }
  return routes;
};

const PUBLIC_ROUTES = [
  'GET /healthz',
  'POST /api/auth/password',
  'POST /api/auth/token',
  'POST /api/auth/logout',
  'POST /api/auth/passkey/login/options',
  'POST /api/auth/passkey/login/verify',
  'GET /api/app-update/manifest',
  'GET /api/app-update/assets/:file',
  'GET /index.html',
  'GET /sw.js',
  'GET /assets/app.js',
  'GET /assets/main-C934z9NI.js',
].flatMap((r) => (r.startsWith('GET ') ? [r, r.replace('GET', 'HEAD')] : [r]));

describe('Guard', () => {
  it.each(PROTECTED.flatMap(([method, path]) => spellings(path).map((url) => [method, url] as const)))(
    'requires a login for %s %s',
    async (method, url) => {
      const res = await app.inject({
        method: method as 'GET',
        url,
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        payload: method === 'GET' ? undefined : '{}',
      });
      expect(res.statusCode, res.body).toBe(401);
    },
  );

  it('answers an anonymous caller that a login is required, but for the few that are public', async () => {
    const routes = routesOf(app);
    expect(routes).toEqual(expect.arrayContaining(['POST /api/m/:machine/sessions/:id/keys', 'GET /api/m/:machine/sessions/:id/journal/items', ...PUBLIC_ROUTES]));
    const open: string[] = [];
    for (const route of routes) {
      const [method, path] = route.split(' ');
      const res = await app.inject({
        method: method as 'GET',
        url: path.replace(/:[^/]+/g, 'abc'),
        headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.8' },
        payload: method === 'GET' || method === 'HEAD' ? undefined : '{}',
      });
      const refused = res.statusCode === 401 && (method === 'HEAD' || res.json().error === 'login required');
      if (!refused) open.push(route);
    }
    expect(open.sort()).toEqual([...PUBLIC_ROUTES].sort());
  });

  describe('for an anonymous visitor', () => {
    it('serves the login page shell and its assets', async () => {
      const page = await app.inject({ url: '/login' });
      expect(page.statusCode, page.body).toBe(200);
      expect((await app.inject({ url: '/' })).body).toContain('workoffdesk');
      expect((await app.inject({ url: '/assets/app.js' })).statusCode).toBe(200);
    });

    it('lets browsers keep built files, whose names change with their content, and ask again for everything else', async () => {
      const cache = async (url: string) => (await app.inject({ url })).headers['cache-control'];
      expect(await cache('/assets/main-C934z9NI.js')).toBe('public, max-age=31536000, immutable');
      expect(await cache('/sw.js')).toBe('public, max-age=0');
      expect(await cache('/')).toBe('no-cache');
      expect(await cache('/m/local/s/abc')).toBe('no-cache');
    });

    it('opens the public login endpoints', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/password',
        headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' },
        payload: { username: 'alice', password: 'wrong' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('wrong username or password');
      const options = await app.inject({ method: 'POST', url: '/api/auth/passkey/login/options', headers: { origin: ORIGIN } });
      expect(options.statusCode).toBe(200);
    });

    it('answers whether the server is up, in every spelling', async () => {
      for (const url of ['/healthz', '/%68ealthz']) {
        const r = await app.inject({ url });
        expect(r.statusCode, url).toBe(200);
        expect(r.json().ok, url).toBe(true);
      }
    });

    it('answers a 404 for an unknown api path, not the page shell', async () => {
      const res = await app.inject({ url: '/api/nope' });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('<title>');
    });
  });
});
