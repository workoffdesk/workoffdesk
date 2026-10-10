import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UPDATE_FILE, hashOf, writeAppUpdate, type AppUpdateBuild } from '../../../src/ios-update/appUpdate.js';

// What `expo export --platform ios` leaves: metadata.json naming the Hermes bundle and the assets, which
// Metro names by their content hash.
const BUNDLE = '_expo/static/js/ios/entry-5d41402abc4b2a76.hbc';
const exported = (o: { assets?: { path: string; ext: string; bytes?: string }[]; skip?: string; ios?: boolean } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'ts-export-'));
  const assets = o.assets ?? [
    { path: 'assets/0123456789abcdef0123456789abcdef', ext: 'png', bytes: 'png bytes' },
    { path: 'assets/fedcba9876543210fedcba9876543210', ext: 'ttf', bytes: '' },
  ];
  const put = (rel: string, bytes: string) => {
    if (rel === o.skip) return;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), bytes);
  };
  put(BUNDLE, 'bundle bytes');
  for (const a of assets) put(a.path, a.bytes ?? a.path);
  const fileMetadata = o.ios === false ? {} : { ios: { bundle: BUNDLE, assets: assets.map(({ path, ext }) => ({ path, ext })) } };
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify({ version: 0, bundler: 'metro', fileMetadata }));
  return dir;
};
const META = { runtimeVersion: 'e67e787c4688fa7a685dcf54c00601de3afa3b43', builtAt: '2026-10-05T12:00:00.000Z', expoClient: { name: 'WorkOffDesk', version: '1.0.0' } };
const out = () => join(mkdtempSync(join(tmpdir(), 'ts-update-')), 'ios');
const read = (dir: string) => JSON.parse(readFileSync(join(dir, UPDATE_FILE), 'utf8')) as AppUpdateBuild;
const base64urlSha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('base64url');

describe('hashOf', () => {
  it('returns the base64url SHA-256 without padding that expo-updates compares', () => {
    expect(hashOf(Buffer.alloc(0))).toBe('47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU');
    expect(hashOf(Buffer.from('bundle bytes'))).toBe(base64urlSha256('bundle bytes'));
  });
});

describe('writeAppUpdate', () => {
  it('copies the bundle and each asset under a name of its own key and extension, and lists them', () => {
    const dir = out();
    writeAppUpdate(exported(), dir, META);
    const u = read(dir);
    expect(u).toMatchObject(META);
    expect(u.launchAsset.hash).toBe(base64urlSha256('bundle bytes'));
    expect(u.launchAsset.file).toBe(`${u.launchAsset.key}.hbc`);
    expect(readFileSync(join(dir, u.launchAsset.file), 'utf8')).toBe('bundle bytes');
    expect(u.assets).toEqual([
      {
        file: '0123456789abcdef0123456789abcdef.png',
        key: '0123456789abcdef0123456789abcdef', // gitleaks:allow (a made-up asset key)
        hash: base64urlSha256('png bytes'),
        fileExtension: '.png',
        contentType: 'image/png',
      },
      {
        file: 'fedcba9876543210fedcba9876543210.ttf',
        key: 'fedcba9876543210fedcba9876543210', // gitleaks:allow (a made-up asset key)
        hash: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU',
        fileExtension: '.ttf',
        contentType: 'font/ttf',
      },
    ]);
    for (const a of u.assets) expect(hashOf(readFileSync(join(dir, a.file)))).toBe(a.hash);
    expect(readdirSync(dir).sort()).toEqual([UPDATE_FILE, u.launchAsset.file, ...u.assets.map((a) => a.file)].sort());
  });

  it('gives the bundle a key that changes with its bytes', () => {
    const a = out();
    const b = out();
    writeAppUpdate(exported(), a, META);
    const other = exported();
    writeFileSync(join(other, BUNDLE), 'other bundle bytes');
    writeAppUpdate(other, b, META);
    expect(read(a).launchAsset.key).not.toBe(read(b).launchAsset.key);
  });

  it('names an asset of an unknown type as plain bytes', () => {
    const dir = out();
    writeAppUpdate(exported({ assets: [{ path: 'assets/aaaa', ext: 'xyz' }] }), dir, META);
    expect(read(dir).assets[0]).toMatchObject({ fileExtension: '.xyz', contentType: 'application/octet-stream' });
  });

  it.each([
    ['an export with no iOS bundle', { ios: false }, /no iOS bundle/],
    ['an export missing a listed asset', { skip: 'assets/0123456789abcdef0123456789abcdef' }, /ENOENT/],
    ['an export missing its bundle', { skip: BUNDLE }, /ENOENT/],
  ])('throws for %s and leaves no update behind, even where one was before', (_, o, error) => {
    const dir = out();
    writeAppUpdate(exported(), dir, META);
    expect(existsSync(join(dir, UPDATE_FILE))).toBe(true);
    expect(() => writeAppUpdate(exported(o), dir, META)).toThrow(error);
    expect(existsSync(join(dir, UPDATE_FILE))).toBe(false);
  });

  it('clears the files of the update it replaces', () => {
    const dir = out();
    writeAppUpdate(exported(), dir, META);
    const before = read(dir);
    writeAppUpdate(exported({ assets: [{ path: 'assets/bbbb', ext: 'png' }] }), dir, META);
    for (const a of before.assets) expect(existsSync(join(dir, a.file))).toBe(false);
    rmSync(dir, { recursive: true });
  });
});
