import { execFile } from 'node:child_process';

// An agent session's pane starts as `<shell> -lc '<agent> …; exec <shell> -l'`. That process waits for the
// agent and, however the agent ends, becomes the login shell: while its command line is still the wrapper's,
// the agent runs.
const WRAPPER = /^\S+ -lc /;
const LOOK_MS = 5_000;
const QUIT_LOOK_MS = 100;

const run = (bin: string, args: string[]) =>
  new Promise<{ code: number; out: string } | null>((resolve) =>
    execFile(bin, args, { timeout: LOOK_MS }, (err, stdout) => {
      const code = err ? (err as { code?: unknown }).code : 0;
      resolve(typeof code === 'number' ? { code, out: String(stdout) } : null);
    }),
  );

// Per pane process, whether the agent it was started with runs; one gone is not running. Null when it could not
// be looked at.
export async function agentsRunning(pids: number[]): Promise<Map<number, boolean> | null> {
  if (!pids.length) return new Map();
  // ps leaves out the processes that are gone, and then exits 1.
  const r = await run('/bin/ps', ['-ww', '-o', 'pid=,args=', '-p', pids.join(',')]);
  if (!r || r.code > 1) return null;
  const args = new Map<number, string>();
  for (const line of r.out.split('\n')) {
    const [, pid, command] = /^\s*(\d+)\s(.*)$/.exec(line) ?? [];
    if (pid) args.set(Number(pid), command);
  }
  return new Map(pids.map((pid) => [pid, WRAPPER.test(args.get(pid) ?? '')]));
}

// What runs under a pane process: its agent, while the agent runs; a program started from a terminal on the Mac,
// in the shell a pane was left with.
async function childrenOf(pid: number): Promise<number[]> {
  const r = await run('/usr/bin/pgrep', ['-P', String(pid)]);
  if (!r || r.code > 1) throw new Error(`could not look at what runs under process ${pid}`);
  return r.out.split('\n').filter(Boolean).map(Number);
}

export async function shellBusy(pid: number): Promise<boolean> {
  return (await childrenOf(pid)).length > 0;
}

// Asks the agent a pane runs to quit, as a terminal's is when it is taken over, and waits for it at most waitMs:
// true once it no longer runs.
export async function quitAgent(pid: number, waitMs: number): Promise<boolean> {
  for (const child of await childrenOf(pid)) {
    try {
      process.kill(child, 'SIGTERM');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
    }
  }
  const until = Date.now() + waitMs;
  for (;;) {
    if ((await agentsRunning([pid]))?.get(pid) === false) return true;
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, QUIT_LOOK_MS));
  }
}
