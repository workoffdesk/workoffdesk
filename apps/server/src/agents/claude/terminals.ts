import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';

// The interactive Claude sessions open on this Mac outside WorkOffDesk, as Claude Code itself lists them
// (`claude agents --json`, once for every config dir a running Claude uses): each one's process, the conversation it writes and whether it is at work. busy: a turn or a shell it started
// is running; waiting: it asks the person something (a permission prompt).
export type MacClaude = { pid: number; sessionId: string; cwd: string; status: 'idle' | 'busy' | 'waiting'; tty: string | null };

// A conversation can be open in more than one terminal at once, each writing it: it is idle only when all are.
export type MacOpen = { claudes: MacClaude[]; status: MacClaude['status'] };

export const busiest = (claudes: MacClaude[]): MacClaude['status'] =>
  claudes.some((c) => c.status === 'waiting') ? 'waiting' : claudes.some((c) => c.status === 'busy') ? 'busy' : 'idle';

const LIST_MS = 5_000;
// How long a Claude told to stop is given to write the rest of its transcript and go: it took under a second.
const STOP_MS = 10_000;
const STOP_LOOK_MS = 100;

const STATUSES = new Set(['idle', 'busy', 'waiting']);

const run = (bin: string, args: string[], env?: NodeJS.ProcessEnv) =>
  new Promise<string>((resolve, reject) =>
    execFile(bin, args, { timeout: LIST_MS, maxBuffer: 16 * 1024 * 1024, env }, (err, stdout) => (err ? reject(err) : resolve(String(stdout)))),
  );

// Asked for again while a listing runs, the one running answers.
const running = new Map<string, Promise<MacClaude[]>>();

// None when Claude Code cannot say (too old for `agents`, not installed): then nothing is known to be open.
export function listMacClaudes(claudeBin: string): Promise<MacClaude[]> {
  const now = running.get(claudeBin);
  if (now) return now;
  const next = listNow(claudeBin)
    .catch(() => [])
    .finally(() => running.delete(claudeBin));
  running.set(claudeBin, next);
  return next;
}

async function listNow(claudeBin: string): Promise<MacClaude[]> {
  const listings = await Promise.all(
    [...(await configDirs())].map((dir) =>
      run(claudeBin, ['agents', '--json'], dir === undefined ? undefined : { ...process.env, CLAUDE_CONFIG_DIR: dir })
        .then((out): unknown => JSON.parse(out))
        .catch((): unknown => []),
    ),
  );
  const listed = listings.flatMap((l) => (Array.isArray(l) ? l : []));
  const found = listed.flatMap((a) =>
    a && a.kind === 'interactive' && Number.isSafeInteger(a.pid) && typeof a.sessionId === 'string' && typeof a.cwd === 'string'
      ? [{ pid: a.pid as number, sessionId: a.sessionId as string, cwd: a.cwd as string, status: STATUSES.has(a.status) ? a.status : 'busy' }]
      : [],
  );
  // One dir can be named two ways (this server's own, and set by a terminal to the same path).
  const interactive = [...new Map(found.map((a) => [a.pid, a])).values()];
  if (!interactive.length) return [];
  const procs = await processes(interactive.map((a) => a.pid));
  return interactive.flatMap((a) => {
    const p = procs.get(a.pid);
    return p && !p.inWorkOffDesk ? [{ ...a, tty: p.tty }] : [];
  });
}

// Where Claude Code keeps who is running: each Claude lists itself in its own config dir, and a terminal can
// set CLAUDE_CONFIG_DIR while sharing the conversations with the rest. undefined: this server's own.
async function configDirs(): Promise<Set<string | undefined>> {
  const dirs = new Set<string | undefined>([undefined]);
  const out = await run('/bin/ps', ['-E', '-ww', '-A', '-o', 'command=']).catch((e) => String(e.stdout ?? ''));
  for (const line of out.split('\n')) {
    // Claude Code's own program, or the one npm installs, which node runs.
    if (!/^(\S*\/)?(node\s+(\S*\/)?)?claude(\s|$)/.test(line)) continue;
    const dir = /(?:^|\s)CLAUDE_CONFIG_DIR=(\S+)/.exec(line)?.[1];
    if (dir) dirs.add(dir);
  }
  return dirs;
}

// Each process's terminal, and whether it runs in a WorkOffDesk session: every session's program is started
// with WORKOFFDESK_SESSION, whichever WorkOffDesk on this Mac started it, and what it starts inherits it.
// One gone since it was listed is left out.
async function processes(pids: number[]): Promise<Map<number, { tty: string | null; inWorkOffDesk: boolean }>> {
  const out = await run('/bin/ps', ['-E', '-ww', '-o', 'pid=,tty=,command=', '-p', pids.join(',')]).catch((e) => String(e.stdout ?? ''));
  const procs = new Map<number, { tty: string | null; inWorkOffDesk: boolean }>();
  for (const line of out.split('\n')) {
    const [, pid, tty, command] = /^\s*(\d+)\s+(\S+)\s(.*)$/.exec(line) ?? [];
    if (!pid) continue;
    procs.set(Number(pid), { tty: /^ttys?\d+$/.test(tty) ? tty : null, inWorkOffDesk: /(^|\s)WORKOFFDESK_SESSION=\S/.test(command) });
  }
  return procs;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

// Tells an agent in a terminal (Claude, Codex) to quit as its own Ctrl-C would, and waits for it to be gone:
// what it writes is whole then. What it was writing in a turn is lost; what the person sent stays. note: said
// in the terminal it leaves, under the agent's own resume line, which would open the conversation a second time.
// False when it would not go in time; it is not killed harder, and must not be resumed while it runs.
export async function stopMacProcess(c: { pid: number; tty: string | null }, note: string): Promise<boolean> {
  try {
    process.kill(c.pid, 'SIGTERM');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
  }
  const until = Date.now() + STOP_MS;
  while (alive(c.pid)) {
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, STOP_LOOK_MS));
  }
  if (c.tty) await say(`/dev/${c.tty}`, note);
  return true;
}

// The terminal may be closed with it (a tab that ran claude alone); then there is no one to tell.
async function say(tty: string, note: string): Promise<void> {
  try {
    const fh = await open(tty, 'w');
    await fh.write(`\r\n${note.replace(/\n/g, '\r\n')}\r\n`).finally(() => fh.close());
  } catch {
    // gone with it
  }
}
