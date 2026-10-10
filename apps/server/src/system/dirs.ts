import { statSync } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

// How many folders one listing gives at most: the picker shows a screenful, and typing narrows it.
export const DIRS_MAX = 50;

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// A path as typed, with a leading ~ standing for home; anything else as it is.
export function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return path;
}

const within = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
const realOrNull = (path: string) => realpath(path).catch(() => null);
const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

// The folders a path typed in the new-session picker points into: those in the folder before its last '/'
// whose names start with what comes after it, ignoring case, and those named with a leading '.' only when
// that part has one too. Nothing outside home is listed, however it is reached (.., a link).
export async function listDirs(typed: string, home: string): Promise<string[]> {
  const path = typed === '~' ? '~/' : typed;
  const cut = path.lastIndexOf('/');
  const parent = expandHome(path.slice(0, cut + 1), home);
  if (!parent.startsWith('/')) return [];
  const dir = resolve(parent);
  const prefix = path.slice(cut + 1).toLowerCase();
  const [realHome, realDir] = await Promise.all([realOrNull(home), realOrNull(dir)]);
  if (!realHome || !realDir || !within(realDir, realHome)) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const names = entries
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && e.name.toLowerCase().startsWith(prefix))
    .filter((e) => prefix.startsWith('.') || !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort(byName);
  const out: string[] = [];
  for (const name of names) {
    if (out.length === DIRS_MAX) break;
    const real = await realOrNull(join(dir, name));
    if (real && within(real, realHome) && (await stat(real).then((s) => s.isDirectory(), () => false))) out.push(join(dir, name));
  }
  return out;
}
