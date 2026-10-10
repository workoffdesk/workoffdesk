import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function homeDir(env: NodeJS.ProcessEnv = process.env, userHome: string = homedir()): string {
  const dir = env.WORKOFFDESK_HOME || join(userHome, '.workoffdesk');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

// The environment for a child process that must run in the given home and nowhere else; HOME follows.
export function envForHome(env: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  return { ...env, WORKOFFDESK_HOME: home, HOME: home };
}

// Where a home's unix socket `name` is: in the home, unless that path is too long for a socket address
// (about 104 bytes on macOS), then in a folder of the temp dir only this user can enter, named by the home.
const SOCKET_PATH_MAX = 100;
export function socketPath(home: string, name: string, tmp: string = tmpdir()): string {
  const inHome = join(resolve(home), name);
  if (Buffer.byteLength(inHome) <= SOCKET_PATH_MAX) return inHome;
  const dir = join(tmp, `workoffdesk-${createHash('sha1').update(resolve(home)).digest('hex').slice(0, 12)}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return join(dir, name);
}

// The tmux server a home's sessions live in: the default home has the plain name, any other home
// (a smoke test, a second install) gets one of its own.
export function tmuxSocketFor(home: string, userHome: string = homedir()): string {
  const dir = resolve(home);
  if (dir === join(userHome, '.workoffdesk')) return 'workoffdesk';
  return `workoffdesk-${createHash('sha256').update(dir).digest('hex').slice(0, 8)}`;
}

export function writeFileAtomic(file: string, content: string): void {
  // Unique per write: the CLI and the server may write the same file at once.
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

export function writeJsonAtomic(file: string, data: unknown): void {
  writeFileAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
}
