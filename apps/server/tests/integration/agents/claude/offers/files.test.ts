import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFiles } from '../../../../../src/agents/claude/offers/files.js';

// The files an `@` in the prompt can name, in a folder of the test's own.
const folder = (files: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'ts-files-'));
  for (const f of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), '');
  }
  return dir;
};
const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
const sorted = (files: string[]) => [...files].sort();

describe('listFiles', () => {
  it('lists, in a git repository, the files it tracks or would, wherever they are, and not those it ignores', async () => {
    const dir = folder(['README.md', '.gitignore', 'src/a/b/c/deep.ts', 'node_modules/kept-by-git.js', 'new.txt', 'secret.env', 'out/app.js']);
    writeFileSync(join(dir, '.gitignore'), 'secret.env\nout/\n');
    git(dir, 'init', '-q');
    git(dir, 'add', 'README.md', '.gitignore', 'src', 'node_modules');
    expect(sorted(await listFiles(dir))).toEqual(['.gitignore', 'README.md', 'new.txt', 'node_modules/kept-by-git.js', 'src/a/b/c/deep.ts']);
  });

  it('lists, outside a repository, files three folders deep, past dot folders, dependencies and builds', async () => {
    const skipped = ['node_modules', 'dist', 'build', 'target', 'vendor', '__pycache__'].map((d) => `${d}/x.js`);
    const dir = folder(['top.md', 'a/one.ts', 'a/b/two.ts', 'a/b/c/three.ts', '.git/HEAD', '.env', 'a/.cache/x', 'a/node_modules/y.js', ...skipped]);
    symlinkSync(join(dir, 'top.md'), join(dir, 'link.md'));
    expect(sorted(await listFiles(dir))).toEqual(['a/b/two.ts', 'a/one.ts', 'top.md']);
  });

  it('lists what can be read, outside a repository, when a folder cannot', async () => {
    const dir = folder(['open/a.ts', 'shut/b.ts']);
    chmodSync(join(dir, 'shut'), 0o000);
    try {
      expect(sorted(await listFiles(dir))).toEqual(['open/a.ts']);
    } finally {
      chmodSync(join(dir, 'shut'), 0o755);
    }
  });

  it('lists none for a folder that is gone', async () => {
    expect(await listFiles(join(tmpdir(), 'ts-files-gone'))).toEqual([]);
  });

  it.each<[string, (dir: string) => void]>([
    ['in a git repository', (dir) => git(dir, 'init', '-q')],
    ['outside one', () => {}],
  ])('lists at most 5000, %s', async (_, make) => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-files-'));
    for (let i = 0; i < 26; i++) {
      mkdirSync(join(dir, `d${i}`));
      for (let j = 0; j < 199; j++) writeFileSync(join(dir, `d${i}`, `f${j}`), '');
    }
    make(dir);
    expect(await listFiles(dir)).toHaveLength(5000);
  });

  it('lists again only once the last listing is 30 seconds old', async () => {
    const dir = folder(['a.ts']);
    const t = 1_000_000;
    const first = listFiles(dir, t);
    expect(await first).toEqual(['a.ts']);
    writeFileSync(join(dir, 'b.ts'), '');
    expect(listFiles(dir, t + 30_000 - 1)).toBe(first);
    expect(sorted(await listFiles(dir, t + 30_000))).toEqual(['a.ts', 'b.ts']);
    expect(sorted(await listFiles(folder(['c.ts']), t))).toEqual(['c.ts']);
  });
});
