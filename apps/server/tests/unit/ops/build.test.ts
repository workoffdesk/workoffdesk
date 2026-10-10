import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_STAMP, readBuildStamp, stampBuild, staleBuild, writeBuildStamp } from '../../../src/ops/build.js';

// A package folder holding a dist, as the build leaves it before its last step.
const pkg = (version = '2.17.5') => {
  const root = mkdtempSync(join(tmpdir(), 'ts-build-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'workoffdesk', version }));
  writeFileSync(join(root, '.gitignore'), 'dist/\n');
  mkdirSync(join(root, 'dist'));
  return root;
};
const git = (root: string, ...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' }).trim();
const committed = (root: string) => {
  git(root, 'init', '-q');
  git(root, 'add', 'package.json', '.gitignore');
  git(root, 'commit', '-q', '-m', 'build');
  return git(root, 'rev-parse', 'HEAD');
};

describe('stampBuild', () => {
  it('names the version in package.json and the commit the source is at', () => {
    const root = pkg('2.17.5');
    const head = committed(root);
    expect(stampBuild(root)).toEqual({ version: '2.17.5', commit: head, dirty: false });
    expect(readBuildStamp(root)).toEqual({ version: '2.17.5', commit: head, dirty: false });
  });

  it.each([
    ['a change to a committed file', (root: string) => writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'workoffdesk', version: '2.17.5', x: 1 }))],
    ['a file not yet committed', (root: string) => writeFileSync(join(root, 'new.ts'), '')],
  ])('says the source had changes beyond the commit when it had %s', (_, change) => {
    const root = pkg();
    committed(root);
    change(root);
    expect(stampBuild(root).dirty).toBe(true);
  });

  it('does not count the dist it stamps as a change', () => {
    const root = pkg();
    committed(root);
    writeFileSync(join(root, 'dist/cli.js'), '');
    expect(stampBuild(root).dirty).toBe(false);
  });

  it('names no commit for a source outside git', () => {
    const root = pkg();
    expect(stampBuild(root)).toEqual({ version: '2.17.5', commit: null, dirty: false });
  });
});

describe('readBuildStamp', () => {
  it.each([
    ['there is none', () => {}],
    ['it is not JSON', (root: string) => writeFileSync(join(root, BUILD_STAMP), '{')],
    ['it is null', (root: string) => writeFileSync(join(root, BUILD_STAMP), 'null')],
    ['it names no version', (root: string) => writeFileSync(join(root, BUILD_STAMP), JSON.stringify({ commit: 'abc' }))],
  ])('finds no stamp when %s', (_, put) => {
    const root = pkg();
    put(root);
    expect(readBuildStamp(root)).toBeNull();
  });

  it('reads back what was written', () => {
    const root = pkg();
    writeBuildStamp(root, { version: '1.2.3', commit: null, dirty: false });
    expect(readBuildStamp(root)).toEqual({ version: '1.2.3', commit: null, dirty: false });
  });
});

describe('staleBuild', () => {
  it.each([
    ['an older version, left over from an earlier build', '2.17.4', { version: '2.17.6', built: '2.17.4' }],
    ['a newer version', '2.17.7', { version: '2.17.6', built: '2.17.7' }],
    ['no version, as a build that failed partway leaves it', null, { version: '2.17.6', built: null }],
  ])('names a dist built for %s', (_, built, stale) => {
    const root = pkg('2.17.6');
    if (built) writeBuildStamp(root, { version: built, commit: null, dirty: false });
    expect(staleBuild(root)).toEqual(stale);
  });

  it('passes a dist built for the version its package.json names', () => {
    const root = pkg('2.17.6');
    stampBuild(root);
    expect(staleBuild(root)).toBeNull();
  });
});
