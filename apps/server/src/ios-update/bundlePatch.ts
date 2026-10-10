import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

// The bundles this server has offered the iPhone app, by update id. The app names the update it runs on
// every download, so the next bundle can go to it as a bsdiff patch against that one: a few KB to a few
// hundred, where the whole bundle is 1.9 MB over a line that drops long downloads.

const KEEP = 20;
const UPDATE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fileOf = (dir: string, id: string) => join(dir, `${id}.bundle`);
// Next to this module, run as it is: compiled, or as TypeScript when the tests import the source.
const WORKER = new URL(`./bundlePatch.worker${extname(new URL(import.meta.url).pathname)}`, import.meta.url);

export function keepBundle(dir: string, id: string, bytes: Buffer): void {
  mkdirSync(dir, { recursive: true });
  const file = fileOf(dir, id);
  if (existsSync(file)) return;
  writeFileSync(`${file}.tmp`, bytes);
  renameSync(`${file}.tmp`, file);
  const kept = readdirSync(dir)
    .filter((n) => n.endsWith('.bundle'))
    .map((n) => ({ n, at: statSync(join(dir, n)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const { n } of kept.slice(KEEP)) rmSync(join(dir, n), { force: true });
}

function bsdiff(base: Buffer, target: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, { workerData: { base, target } });
    worker.once('message', (patch: Uint8Array) => resolve(Buffer.from(patch.buffer, patch.byteOffset, patch.byteLength)));
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`bsdiff worker exited with ${code}`)));
  });
}

// The patch from the bundle `baseId` names to `target`, made once per base; null when this server never
// kept that bundle, in which case the app downloads the whole one.
export function bundlePatcher(dir: string, target: Buffer): (baseId: string) => Promise<Buffer | null> {
  const made = new Map<string, Promise<Buffer | null>>();
  return (baseId) => {
    const id = baseId.toLowerCase();
    if (!UPDATE_ID.test(id)) return Promise.resolve(null);
    let patch = made.get(id);
    if (!patch) {
      let base: Buffer;
      try {
        base = readFileSync(fileOf(dir, id));
      } catch {
        return Promise.resolve(null);
      }
      patch = bsdiff(base, target);
      made.set(id, patch);
    }
    return patch;
  };
}
