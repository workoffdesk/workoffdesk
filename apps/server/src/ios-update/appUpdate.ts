import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

// The iPhone app's JavaScript for the native runtime this build was made with, as the server serves it
// over the expo-updates protocol. The build writes it once (writeAppUpdate); update.json goes last, so a
// folder with one is complete.

export const UPDATE_FILE = 'update.json';

export type AppUpdateAsset = { file: string; key: string; hash: string; fileExtension: string; contentType: string };
export type AppUpdateBuild = {
  runtimeVersion: string;
  builtAt: string;
  // The app config the JS reads as Constants.expoConfig; expo-constants takes it from the manifest.
  expoClient: Record<string, unknown>;
  launchAsset: { file: string; key: string; hash: string };
  assets: AppUpdateAsset[];
};

// The form expo-updates checks a download against: base64url SHA-256, no padding.
export const hashOf = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('base64url');

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  json: 'application/json',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
};

type ExportMetadata = { fileMetadata?: { ios?: { bundle?: string; assets?: { path: string; ext: string }[] } } };

// From what `expo export --platform ios` left in exportDir to a served update in outDir. Assets keep the
// key Metro gave them (their content hash), which is also their key in the binary's own update, so the
// phone copies rather than downloads the ones it has; the bundle is keyed by its SHA-256.
export function writeAppUpdate(exportDir: string, outDir: string, meta: Pick<AppUpdateBuild, 'runtimeVersion' | 'builtAt' | 'expoClient'>): void {
  rmSync(outDir, { recursive: true, force: true });
  const ios = (JSON.parse(readFileSync(join(exportDir, 'metadata.json'), 'utf8')) as ExportMetadata).fileMetadata?.ios;
  if (!ios?.bundle) throw new Error(`no iOS bundle in ${join(exportDir, 'metadata.json')}`);
  mkdirSync(outDir, { recursive: true });

  const bundle = readFileSync(join(exportDir, ios.bundle));
  const bundleKey = createHash('sha256').update(bundle).digest('hex');
  const launchAsset = { file: `${bundleKey}${extname(ios.bundle)}`, key: bundleKey, hash: hashOf(bundle) };
  writeFileSync(join(outDir, launchAsset.file), bundle);

  const assets = (ios.assets ?? []).map(({ path, ext }): AppUpdateAsset => {
    const key = basename(path);
    const file = `${key}.${ext}`;
    copyFileSync(join(exportDir, path), join(outDir, file));
    return { file, key, hash: hashOf(readFileSync(join(outDir, file))), fileExtension: `.${ext}`, contentType: CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream' };
  });

  const update: AppUpdateBuild = { ...meta, launchAsset, assets };
  writeFileSync(join(outDir, UPDATE_FILE), JSON.stringify(update, null, 2));
}

export type ServedUpdate = { build: AppUpdateBuild; files: Map<string, { bytes: Buffer; contentType: string }> };

const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isFile = (v: unknown): v is { file: string; key: string; hash: string } => {
  const f = v as Record<string, unknown> | null;
  return !!f && isText(f.file) && isText(f.key) && isText(f.hash);
};

// The update a build carries, with every file read and checked against its hash, so nothing is offered
// that a phone could not download whole. Null when the build has none; throws when it has a broken one.
export function loadAppUpdate(dir: string): ServedUpdate | null {
  let raw: string;
  try {
    raw = readFileSync(join(dir, UPDATE_FILE), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  const build = JSON.parse(raw) as AppUpdateBuild;
  const assets: unknown[] = Array.isArray(build.assets) ? build.assets : [];
  if (!isText(build.runtimeVersion) || !isText(build.builtAt) || typeof build.expoClient !== 'object' || !build.expoClient || !isFile(build.launchAsset) || !Array.isArray(build.assets) || !assets.every((a) => isFile(a) && isText((a as AppUpdateAsset).fileExtension) && isText((a as AppUpdateAsset).contentType))) {
    throw new Error(`${UPDATE_FILE} is not an update`);
  }
  const files = new Map<string, { bytes: Buffer; contentType: string }>();
  for (const { file, hash, contentType } of [{ ...build.launchAsset, contentType: 'application/javascript' }, ...build.assets]) {
    const bytes = readFileSync(join(dir, basename(file)));
    if (hashOf(bytes) !== hash) throw new Error(`${file} does not match its hash`);
    files.set(file, { bytes, contentType });
  }
  return { build, files };
}

// expo-updates takes an update id as immutable: the same id must always mean the same manifest. So it is
// derived from all that changes one, and nothing else, which keeps it across restarts.
export function updateId(runtimeVersion: string, launchHash: string, createdAt: string): string {
  const h = createHash('sha256').update(`${runtimeVersion}\n${launchHash}\n${createdAt}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function manifestOf(build: AppUpdateBuild, createdAt: string, filesBase: string) {
  const url = (file: string) => `${filesBase}/${encodeURIComponent(file)}`;
  return {
    id: updateId(build.runtimeVersion, build.launchAsset.hash, createdAt),
    createdAt,
    runtimeVersion: build.runtimeVersion,
    launchAsset: { key: build.launchAsset.key, hash: build.launchAsset.hash, url: url(build.launchAsset.file), contentType: 'application/javascript' },
    assets: build.assets.map((a) => ({ key: a.key, hash: a.hash, url: url(a.file), fileExtension: a.fileExtension, contentType: a.contentType })),
    metadata: {},
    extra: { expoClient: build.expoClient },
  };
}
