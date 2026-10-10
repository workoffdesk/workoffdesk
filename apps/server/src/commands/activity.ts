import { watchActivity } from '../sessions/control.js';
import { m } from '../system/messages.js';
import { homeDir, socketPath } from '../system/paths.js';
import { fail } from './common.js';

export type ActivityIO = {
  sock: string;
  print(line: string): void;
  fail(message: string): unknown;
  // Whether the app that ran it is gone: an orphan is adopted by launchd, pid 1.
  orphaned(): boolean;
  checkMs?: number;
};

const real = (): ActivityIO => ({
  sock: socketPath(homeDir(), 'control.sock'),
  print: (line) => console.log(line),
  fail,
  orphaned: () => process.ppid === 1,
});

// What the menu bar app runs: how many sessions are working, a line of JSON now and at each change, until the
// server or the app goes.
export async function activity(args: string[], io: ActivityIO = real()) {
  if (!args.includes('--json')) return io.fail(m.cli.activityUsage);
  const watch = watchActivity(io.sock, (working) => io.print(JSON.stringify({ working })));
  const check = setInterval(() => io.orphaned() && watch.stop(), io.checkMs ?? 5000);
  try {
    await watch.done;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return io.fail(code === 'ENOENT' || code === 'ECONNREFUSED' ? m.cli.notRunning : (e as Error).message);
  } finally {
    clearInterval(check);
  }
}
