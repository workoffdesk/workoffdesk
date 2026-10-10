import { readFileSync } from 'node:fs';
import { loadAppUpdate, manifestOf, updateId, type ServedUpdate } from '../../ios-update/appUpdate.js';
import { bundlePatcher, keepBundle } from '../../ios-update/bundlePatch.js';
import { PUBLIC, type RouteModule } from './context.js';

// The iPhone app's JS over the expo-updates protocol (v1, JSON form): the update this build carries, for
// the native runtime it was built for, and nothing else. Public: the app keeps the headers it fetched an
// update with next to the update, outside the Keychain, so a token has no place here; and the bundle is
// the same one the npm package and the binary hold.

const HOST = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;
// The server's own rule for its address: https, unless it is this machine (config.ts).
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
const FILES_PATH = '/api/app-update/assets';
const PROTOCOL = { 'expo-protocol-version': '1', 'expo-sfv-version': '0' };

// When this release became current, which orders it after whatever the phones ran before, a rollback included.
function activatedAt(file: string | undefined): string | null {
  if (!file) return null;
  try {
    // An invalid date throws here too.
    return new Date(readFileSync(file, 'utf8').trim()).toISOString();
  } catch {
    return null;
  }
}

export const register: RouteModule = (app, ctx) => {
  const where = ctx.deps.appUpdate;
  let served: ServedUpdate | null = null;
  try {
    served = where ? loadAppUpdate(where.dir) : null;
    if (!served) app.log.info('no app update in this build');
  } catch (err) {
    app.log.error({ err }, 'app update in this build is unusable');
  }
  const createdAt = served ? (activatedAt(where?.activatedFile) ?? served.build.builtAt) : '';
  const currentId = served ? updateId(served.build.runtimeVersion, served.build.launchAsset.hash, createdAt) : '';
  const reportedFailed = new Set<string>();
  const bundle = served?.files.get(served.build.launchAsset.file);
  let patchFrom: ReturnType<typeof bundlePatcher> | null = null;
  if (bundle && where?.bundlesDir) {
    try {
      keepBundle(where.bundlesDir, currentId, bundle.bytes);
      patchFrom = bundlePatcher(where.bundlesDir, bundle.bytes);
    } catch (err) {
      app.log.error({ err }, 'cannot keep this app update for patches');
    }
  }

  app.get('/api/app-update/manifest', PUBLIC, async (req, reply) => {
    const header = (name: string) => {
      const v = req.headers[name];
      return typeof v === 'string' ? v : '';
    };
    if (header('expo-protocol-version') !== '1') return reply.code(400).send({ error: 'expo-protocol-version 1 only' });
    const runtime = header('expo-runtime-version');
    if (!runtime) return reply.code(400).send({ error: 'expo-runtime-version is required' });

    const failed = [...header('expo-recent-failed-update-ids').matchAll(/"([^"]*)"/g)].map((m) => m[1].toLowerCase());
    if (currentId && failed.includes(currentId) && !reportedFailed.has(currentId)) {
      reportedFailed.add(currentId);
      req.log.warn({ updateId: currentId }, 'app update failed to launch on a phone');
    }

    // Requests that went well are not logged; this is how one sees whether the phones took an update.
    const checked = (offered: string | null) =>
      req.log.info({ runtime, platform: header('expo-platform'), running: header('expo-current-update-id'), offered }, 'app update check');

    if (!served || header('expo-platform') !== 'ios' || runtime !== served.build.runtimeVersion) {
      checked(null);
      return reply.code(204).headers(PROTOCOL).send();
    }
    const host = header('host');
    if (!HOST.test(host)) return reply.code(400).send({ error: 'bad host' });
    const filesBase = `${LOCAL_HOST.test(host) ? 'http' : 'https'}://${host}${FILES_PATH}`;
    checked(currentId);
    return reply.headers(PROTOCOL).send(manifestOf(served.build, createdAt, filesBase));
  });

  app.get<{ Params: { file: string } }>(`${FILES_PATH}/:file`, PUBLIC, async (req, reply) => {
    const file = served?.files.get(req.params.file);
    if (!file) return reply.code(404).send({ error: 'not found' });
    const base = req.headers['expo-current-update-id'];
    if (patchFrom && file === bundle && typeof base === 'string' && base !== currentId && /\bbsdiff\b/i.test(String(req.headers['a-im'] ?? ''))) {
      const patch = await patchFrom(base).catch((err: unknown) => {
        req.log.error({ err, base }, 'app update patch failed');
        return null;
      });
      if (patch) {
        req.log.info({ base, bytes: patch.length }, 'app update sent as a patch');
        // The same URL answers with the whole bundle to anyone else, so no cache may keep this.
        return reply.code(226).type('application/octet-stream').headers({ im: 'bsdiff', 'expo-base-update-id': base.toLowerCase(), 'cache-control': 'no-store', vary: 'A-IM, Expo-Current-Update-ID' }).send(patch);
      }
    }
    return reply.type(file.contentType).header('cache-control', 'public, max-age=31536000, immutable').send(file.bytes);
  });
};
