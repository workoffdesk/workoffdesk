import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { projectOf } from '../../../src/system/project.js';

// Real repositories, made with git, so what the project is read from is what git writes.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'project-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'protocol.file.allow=always', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const repo = (name: string) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'first');
  return dir;
};
// The repository git itself says a folder is in: its common git directory's folder.
const gitsOwn = (cwd: string) => {
  const common = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  return basename(common) === '.git' ? dirname(common) : common.replace(/\.git$/, '');
};

const app = repo('app');
mkdirSync(join(app, 'src', 'deep'), { recursive: true });
git(app, 'worktree', 'add', '-q', join(root, 'elsewhere', 'feature-x'));
git(app, 'worktree', 'add', '-q', join(app, '.claude', 'worktrees', 'inside'));
const bare = join(root, 'shop.git');
git(root, 'clone', '-q', '--bare', app, bare);
git(bare, 'worktree', 'add', '-q', join(root, 'shop-main'));
const lib = repo('lib');
git(app, 'submodule', 'add', '-q', lib, 'vendor/lib');
const plain = join(root, 'plain', 'notes');
mkdirSync(plain, { recursive: true });

describe('projectOf', () => {
  it.each<[string, string, string]>([
    ['a checkout', app, app],
    ['a folder inside one', join(app, 'src', 'deep'), app],
    ['a worktree made elsewhere', join(root, 'elsewhere', 'feature-x'), app],
    ['a worktree inside the repository', join(app, '.claude', 'worktrees', 'inside'), app],
    ["a bare repository's worktree", join(root, 'shop-main'), join(root, 'shop')],
    ['a submodule, its own repository', join(app, 'vendor', 'lib'), join(app, 'vendor', 'lib')],
  ])('names the repository of %s, as git does', (_, cwd, project) => {
    expect(gitsOwn(cwd), 'precondition: git says so').toBe(project.endsWith('vendor/lib') ? join(app, '.git', 'modules', 'vendor', 'lib') : project);
    expect(projectOf(cwd)).toBe(project);
  });

  it('names one repository the same way however it is reached, through a link too', () => {
    const link = join(root, 'link-to-app');
    symlinkSync(app, link);
    expect(projectOf(join(link, 'src'))).toBe(app);
    expect(projectOf(join(root, 'elsewhere', 'feature-x'))).toBe(app);
  });

  it('has none for a folder outside git', () => {
    expect(projectOf(plain)).toBeNull();
  });

  it('has none for a folder that is gone', () => {
    expect(projectOf(join(root, 'gone', 'away'))).toBeNull();
  });

  it.each([
    ['says nothing git can read', 'not a git file\n'],
    ['points to a git directory that is not there', `gitdir: ${join(root, 'nowhere', '.git', 'worktrees', 'x')}\n`],
  ])('takes the folder of a .git file that %s as the project', (_, text) => {
    const dir = join(root, `odd-${text.length}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.git'), text);
    expect(projectOf(join(dir))).toBe(dir);
  });

  it('takes a worktree whose commondir points nowhere as its own project', () => {
    const dir = join(root, 'broken-common');
    const gitdir = join(root, 'broken-common-git');
    mkdirSync(dir, { recursive: true });
    mkdirSync(gitdir, { recursive: true });
    writeFileSync(join(gitdir, 'commondir'), '../../no/such\n');
    writeFileSync(join(dir, '.git'), `gitdir: ${gitdir}\n`);
    expect(projectOf(dir)).toBe(dir);
  });
});
