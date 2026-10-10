import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Which source a dist was built from. The build writes it last, into a dist it emptied first, so a build
// that failed leaves no stamp, and one left over from another version names that version.
export const BUILD_STAMP = 'dist/build.json';
export type BuildStamp = { version: string; commit: string | null; dirty: boolean };

export function writeBuildStamp(root: string, stamp: BuildStamp): void {
  writeFileSync(join(root, BUILD_STAMP), JSON.stringify(stamp));
}

export function readBuildStamp(root: string): BuildStamp | null {
  try {
    const s = JSON.parse(readFileSync(join(root, BUILD_STAMP), 'utf8')) as Partial<BuildStamp> | null;
    if (typeof s?.version !== 'string') return null;
    return { version: s.version, commit: typeof s.commit === 'string' ? s.commit : null, dirty: s.dirty === true };
  } catch {
    return null;
  }
}

const versionIn = (root: string) => String((JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown }).version);

// The build's last step. A tree that cannot say it is clean counts as having changes.
export function stampBuild(root: string): BuildStamp {
  const version = versionIn(root);
  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const commit = git('rev-parse', 'HEAD');
  const stamp = { version, commit, dirty: commit !== null && git('status', '--porcelain') !== '' };
  writeBuildStamp(root, stamp);
  return stamp;
}

// A dist that was not built for the version its package.json names, which deploy and pack refuse: one
// left over from another version, or from a build that did not finish.
export function staleBuild(root: string): { version: string; built: string | null } | null {
  const version = versionIn(root);
  const built = readBuildStamp(root)?.version ?? null;
  return built === version ? null : { version, built };
}
