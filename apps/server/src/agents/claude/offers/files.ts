import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// How many paths are offered at most, how deep a folder that is not a git repository is walked, and for how
// long a listing is reused.
const MAX_FILES = 5000;
const MAX_DEPTH = 3;
const GIT_TIMEOUT_MS = 3000;
const KEPT_MS = 30_000;
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'target', 'vendor', '__pycache__']);

const kept = new Map<string, { at: number; files: Promise<string[]> }>();

// The files under cwd an `@` can name, relative to it: what git tracks or would (ignored ones left out);
// outside a repository, a shallow walk past dot folders and dependency folders.
export function listFiles(cwd: string, now = Date.now()): Promise<string[]> {
  const hit = kept.get(cwd);
  if (hit && now - hit.at < KEPT_MS) return hit.files;
  const files = gitFiles(cwd).catch(() => walk(cwd));
  kept.set(cwd, { at: now, files });
  files.catch(() => kept.delete(cwd));
  return files;
}

async function gitFiles(cwd: string): Promise<string[]> {
  const { stdout } = await run('git', ['ls-files', '-co', '--exclude-standard'], { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
  return stdout.split('\n').filter(Boolean).slice(0, MAX_FILES);
}

async function walk(cwd: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (rel: string, depth: number): Promise<void> => {
    if (files.length >= MAX_FILES) return;
    const entries = await readdir(join(cwd, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (files.length >= MAX_FILES) return;
      if (e.name.startsWith('.') || SKIPPED.has(e.name)) continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) await visit(path, depth + 1);
      } else if (e.isFile()) files.push(path);
    }
  };
  await visit('', 1);
  return files;
}
