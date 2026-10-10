import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { readBuildStamp, staleBuild } from './build.js';
import { m } from '../system/messages.js';
import { restartService, type Exec } from './service.js';

export type { Exec };

export type ReleaseDeps = {
  home: string;
  label: string;
  uid: number;
  exec: Exec;
  // The version the build must report on /healthz, or null for a build too old to have it.
  health: (version: string | null) => Promise<boolean>;
  smoke: (appDir: string) => Promise<boolean>;
  now?: () => Date;
};
export type Outcome = { ok: boolean; release: string; message: string };

const KEEP = 3;
const MARKER = '.complete';
const PARTIAL = '.partial';
export const ACTIVATED = '.activated';

export const releasesDir = (home: string) => join(home, 'releases');
const appLink = (home: string) => join(home, 'app');

// The marker is written last, so a release without one is a copy that never finished.
// It carries the order releases were made in, which does not depend on the clock.
function seqOf(home: string, name: string): number | null {
  try {
    const { seq } = JSON.parse(readFileSync(join(releasesDir(home), name, MARKER), 'utf8')) as { seq?: unknown };
    return typeof seq === 'number' ? seq : null;
  } catch {
    return null;
  }
}

function markComplete(dir: string, seq: number, at: Date): void {
  writeFileSync(join(dir, MARKER), JSON.stringify({ seq, at: at.toISOString() }));
}

export function listReleases(home: string): string[] {
  if (!existsSync(releasesDir(home))) return [];
  return readdirSync(releasesDir(home))
    .filter((n) => !n.endsWith(PARTIAL))
    .map((name) => ({ name, seq: seqOf(home, name) }))
    .filter((r): r is { name: string; seq: number } => r.seq !== null)
    .sort((a, b) => b.seq - a.seq)
    .map((r) => r.name);
}

const nextSeq = (home: string) => Math.max(0, ...listReleases(home).map((n) => seqOf(home, n)!)) + 1;

export function currentRelease(home: string): string | undefined {
  try {
    return basename(readlinkSync(appLink(home)));
  } catch {
    return undefined;
  }
}

function pointAppAt(home: string, name: string): void {
  const tmp = `${appLink(home)}.tmp`;
  rmSync(tmp, { force: true });
  symlinkSync(join(releasesDir(home), name), tmp);
  renameSync(tmp, appLink(home));
}

// The path a service should start `cli` by. Node hands a script its real path, so a cli run through
// the app link names one release; started by that path, the service would outlive every later deploy.
export function launchEntry(cli: string, home: string): string {
  let releases: string;
  try {
    releases = realpathSync(releasesDir(home));
  } catch {
    return cli;
  }
  const [release, ...rest] = relative(releases, cli).split(sep);
  if (release === '..') return cli;
  return join(appLink(home), ...rest);
}

const removeRelease = (home: string, name: string) => rmSync(join(releasesDir(home), name), { recursive: true, force: true });

const isDir = (p: string) => existsSync(p) && lstatSync(p).isDirectory();
const isBuild = (dir: string) => existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'dist/server/cli.js'));
// Builds from before 2.0.0 have no /healthz. A build has it under http/ when its server is laid out by layer.
const HEALTH_ROUTE = ['dist/server/http/routes/health.js', 'dist/server/routes/health.js'];
const reportsVersion = (dir: string) => HEALTH_ROUTE.some((f) => existsSync(join(dir, f)));
export const versionOf = (dir: string) => String((JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: unknown }).version);

// v1 ran from a plain app folder, with the build before it in app.old.
export function migrateLayout(home: string): void {
  const app = appLink(home);
  const old = join(home, 'app.old');
  if (!isDir(app) && !isDir(old)) return;
  mkdirSync(releasesDir(home), { recursive: true });
  const at = new Date(0);
  if (isDir(old)) {
    const dir = join(releasesDir(home), 'v1-previous');
    renameSync(old, dir);
    markComplete(dir, nextSeq(home), at);
  }
  if (isDir(app)) {
    const dir = join(releasesDir(home), 'v1-current');
    renameSync(app, dir);
    markComplete(dir, nextSeq(home), at);
    pointAppAt(home, 'v1-current');
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

function freshName(home: string, at: Date): string {
  const base = stamp(at);
  let name = base;
  for (let n = 2; existsSync(join(releasesDir(home), name)); n++) name = `${base}-${n}`;
  return name;
}

// Points app at a release and restarts; when it does not come up, points app back where it was. The
// release learns when it began to serve before it starts; the one gone back to keeps its time, as it
// never stopped serving.
async function switchTo(d: ReleaseDeps, name: string, from: string | undefined): Promise<boolean> {
  const dir = join(releasesDir(d.home), name);
  writeFileSync(join(dir, ACTIVATED), (d.now ?? (() => new Date()))().toISOString());
  pointAppAt(d.home, name);
  await restartService(d);
  if (await d.health(reportsVersion(dir) ? versionOf(dir) : null)) return true;
  if (from) {
    pointAppAt(d.home, from);
    await restartService(d);
  } else {
    unlinkSync(appLink(d.home));
  }
  return false;
}

// The native runtime of the iPhone app the build's JS update is for; the server serves it to no other.
function appRuntimeOf(dir: string): string | null {
  try {
    return (JSON.parse(readFileSync(join(dir, 'dist/app-update/ios/update.json'), 'utf8')) as { runtimeVersion?: string }).runtimeVersion ?? null;
  } catch {
    return null;
  }
}

function prune(home: string, keep: (string | undefined)[]): void {
  for (const name of readdirSync(releasesDir(home))) {
    if (name.endsWith(PARTIAL)) removeRelease(home, name);
  }
  for (const name of listReleases(home).slice(KEEP)) {
    if (!keep.includes(name)) removeRelease(home, name);
  }
}

// newAppRuntime: the iPhone update may be for another runtime than the live one's, or go, as when a new build of
// the app is out. Without it, phones on the live runtime would be left with no updates and nothing would say so.
export async function deploy(src: string, d: ReleaseDeps, { newAppRuntime = false } = {}): Promise<Outcome> {
  if (!isBuild(src)) return { ok: false, release: '', message: m.release.notABuild(src) };
  const stale = staleBuild(src);
  if (stale) return { ok: false, release: '', message: m.release.staleBuild(stale.version, stale.built) };
  migrateLayout(d.home);
  const live = currentRelease(d.home);
  const liveRuntime = live ? appRuntimeOf(join(releasesDir(d.home), live)) : null;
  if (liveRuntime && appRuntimeOf(src) !== liveRuntime && !newAppRuntime)
    return { ok: false, release: '', message: m.release.appRuntimeChanged(liveRuntime, appRuntimeOf(src)) };
  mkdirSync(releasesDir(d.home), { recursive: true });
  const at = (d.now ?? (() => new Date()))();
  const name = freshName(d.home, at);
  const partial = join(releasesDir(d.home), `${name}${PARTIAL}`);
  cpSync(src, partial, { recursive: true, verbatimSymlinks: true });
  markComplete(partial, nextSeq(d.home), at);
  renameSync(partial, join(releasesDir(d.home), name));

  const dir = join(releasesDir(d.home), name);
  if (!(await d.smoke(dir))) {
    removeRelease(d.home, name);
    return { ok: false, release: name, message: m.release.smokeFailed(versionOf(src)) };
  }
  const prev = currentRelease(d.home);
  if (!(await switchTo(d, name, prev))) {
    removeRelease(d.home, name);
    return { ok: false, release: name, message: m.release.didNotComeUp(versionOf(src), prev) };
  }
  prune(d.home, [name, prev]);
  return {
    ok: true,
    release: name,
    message: [m.release.deployed(versionOf(dir), name), m.release.builtFrom(readBuildStamp(dir)!), m.release.appUpdate(appRuntimeOf(dir))].join('\n'),
  };
}

// The release rollback goes to: the newest one that is not running.
export const rollbackTarget = (home: string): string | undefined => listReleases(home).find((n) => n !== currentRelease(home));

export async function rollback(d: ReleaseDeps): Promise<Outcome> {
  migrateLayout(d.home);
  const current = currentRelease(d.home);
  const target = rollbackTarget(d.home);
  if (!target) return { ok: false, release: '', message: m.release.nothingToRollBackTo };
  if (!(await switchTo(d, target, current))) {
    return { ok: false, release: target, message: m.release.rollbackFailed(target, current) };
  }
  return { ok: true, release: target, message: m.release.rolledBack(versionOf(join(releasesDir(d.home), target)), target) };
}

// Polls the service on its loopback port until it reports `version`, or for a build with no /healthz
// until anything answers there.
export function healthOn(port: number, waitMs: number) {
  return async (version: string | null): Promise<boolean> => {
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`).catch(() => null);
      if (res && version === null) return true;
      const health = res?.ok ? ((await res.json().catch(() => null)) as { version?: string } | null) : null;
      if (health?.version === version) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  };
}
