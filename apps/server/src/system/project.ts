import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

// The git repository a folder is in, by its main folder, read from what git writes: a checkout's `.git` is a
// directory; a worktree's is a file naming its git directory, whose `commondir` names the repository's (a bare
// repository's worktree too). A `.git` file whose git directory has no `commondir` (a submodule), or that git
// could not read, makes its own folder the project. Null outside git. Its real path, so one reached through a
// link is one project with its worktrees. Kept per folder: a folder's repository does not change under a session.
const known = new Map<string, string | null>();

export function projectOf(cwd: string): string | null {
  if (!known.has(cwd)) known.set(cwd, real(find(resolve(cwd))));
  return known.get(cwd)!;
}

function find(dir: string): string | null {
  for (let at = dir; ; at = dirname(at)) {
    const dotGit = join(at, '.git');
    const kind = kindOf(dotGit);
    if (kind === 'dir') return at;
    if (kind === 'file') return fromFile(dotGit) ?? at;
    if (dirname(at) === at) return null;
  }
}

function fromFile(dotGit: string): string | null {
  const gitdir = /^gitdir: (.+)$/m.exec(read(dotGit) ?? '')?.[1]?.trim();
  if (!gitdir) return null;
  const own = isAbsolute(gitdir) ? gitdir : resolve(dirname(dotGit), gitdir);
  const common = read(join(own, 'commondir'))?.trim();
  if (!common) return null;
  const repo = resolve(own, common);
  if (kindOf(repo) !== 'dir') return null;
  return basename(repo) === '.git' ? dirname(repo) : repo.replace(/\.git$/, '');
}

function kindOf(path: string): 'dir' | 'file' | null {
  try {
    const s = statSync(path);
    return s.isDirectory() ? 'dir' : s.isFile() ? 'file' : null;
  } catch {
    return null;
  }
}

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function real(path: string | null): string | null {
  if (!path) return null;
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
