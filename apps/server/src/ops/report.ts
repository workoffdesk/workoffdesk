import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBuildStamp, type BuildStamp } from './build.js';
import type { Check } from './doctor.js';
import type { Messages } from '../system/messages.js';
import { ACTIVATED, currentRelease, listReleases, releasesDir, rollbackTarget, versionOf } from './release.js';
import { VERSION } from '../system/version.js';
import { readLastOp, type LastOp, type OpKind } from './lastOp.js';

// What the server knows of the Mac it runs on, for the This Mac page.

export type OpsDeps = {
  // The service's home, where its releases, logs and ops.json are.
  home: string;
  // Whether launchd runs this process as the service (service.ts isManaged): only then can it be restarted.
  managed: boolean;
  startedAt: number;
  // The package folder this server runs from, whose dist/build.json says what it was built from.
  buildRoot: string;
  doctor: (messages: Messages) => Promise<Check[]>;
  // Starts the helper that does the work and answers its pid.
  spawnOp: (op: OpKind) => number;
};

export type Release = { name: string; version: string; activatedAt: string | null };
export type MacReport = {
  checks: Check[];
  version: string;
  build: BuildStamp | null;
  release: string | null;
  releases: Release[];
  rollbackTo: string | null;
  managed: boolean;
  startedAt: number;
  lastOp: LastOp | null;
};

const activatedAt = (dir: string) => {
  try {
    return readFileSync(join(dir, ACTIVATED), 'utf8').trim() || null;
  } catch {
    return null;
  }
};

export function releasesOf(home: string): Release[] {
  return listReleases(home).map((name) => {
    const dir = join(releasesDir(home), name);
    let version = '';
    try {
      version = versionOf(dir);
    } catch {
      // a release whose package.json is unreadable still shows by name
    }
    return { name, version, activatedAt: activatedAt(dir) };
  });
}

export async function macReport(o: OpsDeps, messages: Messages): Promise<MacReport> {
  return {
    checks: await o.doctor(messages),
    version: VERSION,
    build: readBuildStamp(o.buildRoot),
    release: currentRelease(o.home) ?? null,
    releases: releasesOf(o.home),
    rollbackTo: rollbackTarget(o.home) ?? null,
    managed: o.managed,
    startedAt: o.startedAt,
    lastOp: readLastOp(o.home),
  };
}
