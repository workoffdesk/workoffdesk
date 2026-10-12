import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/http/app.js';
import { UPDATE_FILE, writeAppUpdate, type AppUpdateBuild } from '../../../../src/ios-update/appUpdate.js';
import { Journal } from '../../../../src/journal/index.js';
import type { LocalMachine } from '../../../../src/sessions/machine.js';
import { Store } from '../../../../src/system/store.js';
import { applied } from '../../../helpers/bspatch.js';

// The iPhone app asks its server for a JS update the way expo-updates does on iOS. The server answers
// only with the update its own build carries, only for the native runtime it was built for, to anyone:
// the bundle is the same one the binary holds.

const RUNTIME = 'e67e787c4688fa7a685dcf54c00601de3afa3b43';
const BUILT_AT = '2026-10-05T12:00:00.000Z';
const EXPO_CLIENT = { name: 'WorkOffDesk', version: '1.0.0', ios: { bundleIdentifier: 'com.example.workoffdesk' } };
// What expo-updates 57 sends with a manifest request (FileDownloader.setManifestHTTPHeaderFields).
const CLIENT: Record<string, string> = {
  host: 'mac.tail.ts.net',
  accept: 'multipart/mixed,application/expo+json,application/json',
  'expo-platform': 'ios',
  'expo-protocol-version': '1',
  'expo-api-version': '1',
  'expo-updates-environment': 'BARE',
  'eas-client-id': '1F5B6C2E-6D0E-4C6B-9A39-1A3E7C1E2B11',
  'expo-json-error': 'true',
  'expo-runtime-version': RUNTIME,
};
const MANIFEST = '/api/app-update/manifest';
const machine = {
  id: 'local',
  watch: () => () => {},
  onChange: () => () => {},
  listSessions: async () => [],
  journal: new Journal({ file: ':memory:', log: () => {} }),
} as unknown as LocalMachine;

const exported = (bundle = 'bundle bytes') => {
  const dir = mkdtempSync(join(tmpdir(), 'ts-export-'));
  const files: Record<string, string> = {
    '_expo/static/js/ios/entry-1.hbc': bundle,
    'assets/0123456789abcdef0123456789abcdef': 'png bytes',
    'assets/fedcba9876543210fedcba9876543210': '',
  };
  for (const [rel, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), bytes);
  }
  const assets = [
    { path: 'assets/0123456789abcdef0123456789abcdef', ext: 'png' },
    { path: 'assets/fedcba9876543210fedcba9876543210', ext: 'ttf' },
  ];
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify({ version: 0, bundler: 'metro', fileMetadata: { ios: { bundle: '_expo/static/js/ios/entry-1.hbc', assets } } }));
  return dir;
};
// A build's app-update folder, as the build step writes it.
const built = (bundle?: string) => {
  const root = mkdtempSync(join(tmpdir(), 'ts-release-'));
  const dir = join(root, 'dist/app-update/ios');
  writeAppUpdate(exported(bundle), dir, { runtimeVersion: RUNTIME, builtAt: BUILT_AT, expoClient: EXPO_CLIENT });
  return { dir, activatedFile: join(root, '.activated') };
};

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});
const serve = async (appUpdate?: { dir: string; activatedFile?: string; bundlesDir?: string }) => {
  const home = mkdtempSync(join(tmpdir(), 'ts-app-update-'));
  const lines: { level: number; msg: string; [k: string]: unknown }[] = [];
  const logger = pino(
    { level: 'info' },
    new Writable({
      write(chunk, _enc, done) {
        lines.push(JSON.parse(String(chunk)));
        done();
      },
    }),
  );
  const { app } = await buildApp({ store: new Store(join(home, 'state.json')), machine, origin: 'https://mac.tail.ts.net', rpId: 'mac.tail.ts.net', auditPath: join(home, 'audit.log'), logger, appUpdate });
  apps.push(app);
  const ask = (headers: Record<string, string | undefined> = {}) => {
    const h = { ...CLIENT, ...headers };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    return app.inject({ method: 'GET', url: MANIFEST, headers: h as Record<string, string> });
  };
  return { app, ask, lines };
};
const manifestOf = (res: { json: () => unknown }) =>
  res.json() as {
    id: string;
    createdAt: string;
    runtimeVersion: string;
    launchAsset: { key: string; hash: string; url: string; contentType: string };
    assets: { key: string; hash: string; url: string; fileExtension: string; contentType: string }[];
    metadata: object;
    extra: { expoClient: object };
  };
const sha256url = (b: Buffer) => createHash('sha256').update(b).digest('base64url');
const noUpdate = (res: { statusCode: number; headers: Record<string, unknown>; body: string }) => {
  expect(res.statusCode).toBe(204);
  expect(res.headers['expo-protocol-version']).toBe('1');
  expect(res.body).toBe('');
};

describe('GET /api/app-update/manifest', () => {
  it('answers the iOS client with its update for its runtime, in the form expo-updates reads', async () => {
    const { ask } = await serve(built());
    const res = await ask();
    expect(res.statusCode).toBe(200);
    expect(res.headers['expo-protocol-version']).toBe('1');
    expect(res.headers['expo-sfv-version']).toBe('0');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const m = manifestOf(res);
    expect(Object.keys(m).sort()).toEqual(['assets', 'createdAt', 'extra', 'id', 'launchAsset', 'metadata', 'runtimeVersion']);
    expect(m.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(m.createdAt).toBe(BUILT_AT);
    expect(m.runtimeVersion).toBe(RUNTIME);
    expect(m.metadata).toEqual({});
    expect(m.extra).toEqual({ expoClient: EXPO_CLIENT });
    expect(m.launchAsset.contentType).toBe('application/javascript');
    expect(m.assets.map((a) => [a.key, a.fileExtension, a.contentType])).toEqual([
      ['0123456789abcdef0123456789abcdef', '.png', 'image/png'],
      ['fedcba9876543210fedcba9876543210', '.ttf', 'font/ttf'],
    ]);
  });

  it.each([
    ['an older runtime', 'a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1'],
    ['a newer runtime', `${RUNTIME}0`],
    ['the runtime in other case', RUNTIME.toUpperCase()],
  ])('has no update for %s', async (_, runtime) => {
    const { ask } = await serve(built());
    noUpdate(await ask({ 'expo-runtime-version': runtime }));
  });

  it.each([
    ['no runtime', { 'expo-runtime-version': undefined }],
    ['an empty runtime', { 'expo-runtime-version': '' }],
    ['no protocol version', { 'expo-protocol-version': undefined }],
    ['protocol 0', { 'expo-protocol-version': '0' }],
    ['protocol 2', { 'expo-protocol-version': '2' }],
  ])('refuses a request with %s', async (_, headers) => {
    const { ask } = await serve(built());
    expect((await ask(headers)).statusCode).toBe(400);
  });

  it.each([
    ['android', { 'expo-platform': 'android' }],
    ['no platform', { 'expo-platform': undefined }],
  ])('has no update for %s', async (_, headers) => {
    const { ask } = await serve(built());
    noUpdate(await ask(headers));
  });

  it('needs no login, and a token that is no login does not stop it', async () => {
    const { app, ask } = await serve(built());
    // The guard is alive: a route that is not public still wants a login.
    expect((await app.inject({ method: 'GET', url: '/api/claude/projects' })).statusCode).toBe(401);
    expect((await ask()).statusCode).toBe(200);
    expect((await ask({ authorization: 'Bearer not-a-login' })).statusCode).toBe(200);
  });

  it.each([
    ['mac.tail.ts.net', 'https://mac.tail.ts.net'],
    ['192.168.1.5:7681', 'https://192.168.1.5:7681'],
    ['localhost:7681', 'http://localhost:7681'],
    ['127.0.0.1:7681', 'http://127.0.0.1:7681'],
  ])('names its files under the address the phone asked, %s', async (host, base) => {
    const { ask } = await serve(built());
    const m = manifestOf(await ask({ host }));
    for (const url of [m.launchAsset.url, ...m.assets.map((a) => a.url)]) expect(url.startsWith(`${base}/api/app-update/assets/`)).toBe(true);
  });

  // A request always has a host (light-my-request fills in an empty one), so only ones that would change the URL.
  it.each([['a host with a user', 'a@evil.test'], ['a host with a path', 'evil.test/x'], ['a host with a query', 'evil.test?x']])('refuses %s', async (_, host) => {
    const { ask } = await serve(built());
    expect((await ask({ host })).statusCode).toBe(400);
  });

  it('keeps the same id across requests and restarts, and a new one when the release becomes current again', async () => {
    const release = built();
    const first = manifestOf(await (await serve(release)).ask());
    const again = manifestOf(await (await serve(release)).ask());
    expect(again.id).toBe(first.id);

    writeFileSync(release.activatedFile, '2026-10-06T08:00:00.000Z');
    const reactivated = manifestOf(await (await serve(release)).ask());
    expect(reactivated.id).not.toBe(first.id);
    expect(reactivated.createdAt).toBe('2026-10-06T08:00:00.000Z');
  });

  it('dates the update by its build when the release says nothing usable about when it became current', async () => {
    const release = built();
    writeFileSync(release.activatedFile, 'not a time');
    expect(manifestOf(await (await serve(release)).ask()).createdAt).toBe(BUILT_AT);
  });

  it('gives other JS another id', async () => {
    const a = manifestOf(await (await serve(built('one'))).ask());
    const b = manifestOf(await (await serve(built('two'))).ask());
    expect(a.id).not.toBe(b.id);
  });

  it('only names files the phone can store under that name', async () => {
    const { ask } = await serve(built());
    const m = manifestOf(await ask());
    // expo-updates' UpdatesUtils.isSafeFilename, for key + extension.
    const safe = (name: string) => name !== '' && name !== '.' && name !== '..' && !/[/\\\0]/.test(name);
    for (const a of m.assets) expect(safe(a.key + a.fileExtension)).toBe(true);
    expect(safe(m.launchAsset.key)).toBe(true);
  });

  // A request that went well is not logged (app.ts); whether the phones took an update is looked for.
  it('notes each check: the update the phone runs, the one built in, those that failed, and the one offered', async () => {
    const { ask, lines } = await serve(built());
    const checks = () => lines.filter((l) => l.msg === 'app update check');
    const { id } = manifestOf(
      await ask({ 'expo-current-update-id': 'embedded-id', 'expo-embedded-update-id': 'embedded-id', 'expo-recent-failed-update-ids': '"AB12", "cd34"' }),
    );
    noUpdate(await ask({ 'expo-runtime-version': 'other', 'expo-current-update-id': id }));
    expect(checks()).toEqual([
      expect.objectContaining({ level: 30, runtime: RUNTIME, platform: 'ios', running: 'embedded-id', embedded: 'embedded-id', failed: ['ab12', 'cd34'], offered: id }),
      expect.objectContaining({ level: 30, runtime: 'other', platform: 'ios', running: id, embedded: '', failed: [], offered: null }),
    ]);
  });

  it('notes no check for a request that is not one', async () => {
    const { ask, lines } = await serve(built());
    expect((await ask({ 'expo-protocol-version': undefined })).statusCode).toBe(400);
    expect((await ask({ host: 'a/b' })).statusCode).toBe(400);
    expect(lines.filter((l) => l.msg === 'app update check')).toEqual([]);
  });

  it('logs once when a phone says the update it serves failed to launch', async () => {
    const { ask, lines } = await serve(built());
    const { id } = manifestOf(await ask());
    const failed = () => lines.filter((l) => l.msg === 'app update failed to launch on a phone');
    await ask({ 'expo-recent-failed-update-ids': '"00000000-0000-0000-0000-000000000000"' });
    expect(failed()).toHaveLength(0);
    await ask({ 'expo-recent-failed-update-ids': `"${id}"` });
    await ask({ 'expo-recent-failed-update-ids': `"00000000-0000-0000-0000-000000000000", "${id}"` });
    expect(failed()).toHaveLength(1);
    expect(failed()[0]).toMatchObject({ level: 40, updateId: id });
  });

  describe('with a build without a whole update', () => {
    it('has no update when the server is given none', async () => {
      const { ask } = await serve();
      noUpdate(await ask());
    });

    it('has no update when the build has no update.json', async () => {
      const { ask, lines } = await serve({ dir: join(mkdtempSync(join(tmpdir(), 'ts-none-')), 'ios') });
      noUpdate(await ask());
      expect(lines.filter((l) => l.level >= 50)).toEqual([]);
      expect(lines.filter((l) => l.msg === 'no app update in this build')).toHaveLength(1);
    });

    it.each([
      ['a listed file is missing', (dir: string, u: AppUpdateBuild) => rmSync(join(dir, u.assets[0].file))],
      ['a file is not what update.json says', (dir: string, u: AppUpdateBuild) => writeFileSync(join(dir, u.launchAsset.file), 'changed')],
      ['update.json is not JSON', (dir: string) => writeFileSync(join(dir, UPDATE_FILE), '{')],
      ['update.json lacks the runtime', (dir: string, u: AppUpdateBuild) => writeFileSync(join(dir, UPDATE_FILE), JSON.stringify({ ...u, runtimeVersion: undefined }))],
    ])('has no update, and says so once, when %s', async (_, spoil) => {
      const release = built();
      const u = JSON.parse(readFileSync(join(release.dir, UPDATE_FILE), 'utf8')) as AppUpdateBuild;
      spoil(release.dir, u);
      const { ask, lines } = await serve(release);
      noUpdate(await ask());
      noUpdate(await ask());
      expect(lines.filter((l) => l.level === 50 && l.msg === 'app update in this build is unusable')).toHaveLength(1);
    });
  });
});

describe('GET /api/app-update/assets/:name', () => {
  it('serves the bytes the manifest hashes, cached for good', async () => {
    const { app, ask } = await serve(built());
    const m = manifestOf(await ask());
    for (const a of [m.launchAsset, ...m.assets]) {
      const res = await app.inject({ method: 'GET', url: new URL(a.url).pathname });
      expect(res.statusCode).toBe(200);
      expect(sha256url(res.rawPayload)).toBe(a.hash);
      expect(res.headers['content-type']).toBe(a.contentType);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    }
  });

  it.each(['nope.png', UPDATE_FILE, '..%2Fupdate.json', '%2E%2E%2F%2E%2E%2Fpackage.json'])('serves only those listed: %s is not found', async (name) => {
    const { app } = await serve(built());
    expect((await app.inject({ method: 'GET', url: `/api/app-update/assets/${name}` })).statusCode).toBe(404);
  });

  it('finds none when the build has no update', async () => {
    const { app } = await serve();
    expect((await app.inject({ method: 'GET', url: '/api/app-update/assets/x.png' })).statusCode).toBe(404);
  });

  describe('the bundle, to a phone that runs one this server offered before', () => {
    const OLD = Array.from({ length: 300 }, (_, i) => `line ${i} of the bundle\n`).join('');
    const NEW = OLD.replace('line 150 of', 'line 150, changed, of');
    const PATCHES = { 'a-im': 'bsdiff' };
    // The phone took the old update from this server; the server has since been updated to the new one.
    const updated = async () => {
      const bundlesDir = join(mkdtempSync(join(tmpdir(), 'ts-home-')), 'app-bundles');
      const before = await serve({ ...built(OLD), bundlesDir });
      const running = manifestOf(await before.ask()).id;
      const now = await serve({ ...built(NEW), bundlesDir });
      const m = manifestOf(await now.ask({ 'expo-current-update-id': running }));
      const get = (headers: Record<string, string> = {}, url = new URL(m.launchAsset.url).pathname) => now.app.inject({ method: 'GET', url, headers });
      return { ...now, running, m, get };
    };
    const whole = (res: { statusCode: number; headers: Record<string, unknown>; body: string }) => {
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(res.headers.im).toBeUndefined();
      return res.body;
    };

    it('is a patch from the one it runs, which turns it into the one offered', async () => {
      const { running, m, get, lines } = await updated();
      expect(m.id).not.toBe(running);
      const res = await get({ ...PATCHES, 'expo-current-update-id': running.toUpperCase() });
      expect(res.statusCode).toBe(226);
      expect(res.headers).toMatchObject({ im: 'bsdiff', 'expo-base-update-id': running, 'content-type': 'application/octet-stream', 'cache-control': 'no-store', vary: 'A-IM, Expo-Current-Update-ID' });
      expect(res.rawPayload.length).toBeLessThan(NEW.length / 4);
      const bundle = await applied(Buffer.from(OLD), res.rawPayload);
      expect(sha256url(bundle)).toBe(m.launchAsset.hash);
      expect(lines).toContainEqual(expect.objectContaining({ msg: 'app update sent as a patch', base: running.toUpperCase(), bytes: res.rawPayload.length }));
    });

    it.each<[string, (running: string, offered: string) => Record<string, string>]>([
      ['the phone does not take patches', (running) => ({ 'expo-current-update-id': running })],
      ['the phone takes patches of another kind', (running) => ({ 'a-im': 'vcdiff', 'expo-current-update-id': running })],
      ['the phone does not say what it runs', () => PATCHES],
      ['the phone runs the update offered', (_, offered) => ({ ...PATCHES, 'expo-current-update-id': offered })],
      ['the phone runs an update from elsewhere, its embedded one', () => ({ ...PATCHES, 'expo-current-update-id': '0a0b0c0d-0000-4000-8000-000000000009' })],
    ])('is whole when %s', async (_, headers) => {
      const { running, m, get } = await updated();
      expect(whole(await get(headers(running, m.id)))).toBe(NEW);
    });

    it('is the only file sent as a patch', async () => {
      const { running, m, get } = await updated();
      expect(whole(await get({ ...PATCHES, 'expo-current-update-id': running }, new URL(m.assets[0].url).pathname))).toBe('png bytes');
    });

    it('is whole from a server that keeps no bundles', async () => {
      const before = await serve(built(OLD));
      const running = manifestOf(await before.ask()).id;
      const now = await serve(built(NEW));
      const m = manifestOf(await now.ask());
      expect(whole(await now.app.inject({ method: 'GET', url: new URL(m.launchAsset.url).pathname, headers: { ...PATCHES, 'expo-current-update-id': running } }))).toBe(NEW);
    });

    it('is whole, and the server still serves, when it cannot keep bundles', async () => {
      const bundlesDir = join(mkdtempSync(join(tmpdir(), 'ts-home-')), 'app-bundles');
      writeFileSync(bundlesDir, 'a file where the folder would be');
      const { app, ask, lines } = await serve({ ...built(NEW), bundlesDir });
      const m = manifestOf(await ask());
      expect(lines).toContainEqual(expect.objectContaining({ level: 50, msg: 'cannot keep this app update for patches' }));
      expect(whole(await app.inject({ method: 'GET', url: new URL(m.launchAsset.url).pathname, headers: { ...PATCHES, 'expo-current-update-id': '0a0b0c0d-0000-4000-8000-000000000009' } }))).toBe(NEW);
    });
  });
});
