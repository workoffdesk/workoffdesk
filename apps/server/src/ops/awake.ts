import type { ChildProcess, spawn as Spawn } from 'node:child_process';

// A Mac that idle-sleeps takes its sessions off the phone. caffeinate -i holds off idle sleep only (the
// display still sleeps, a closed lid still sleeps the Mac), and -w ends it with the process it watches.
export function keepAwake(o: {
  enabled: boolean;
  platform: NodeJS.Platform;
  pid: number;
  spawn: typeof Spawn;
  log: (msg: string, err: Error) => void;
}): ChildProcess | undefined {
  if (!o.enabled || o.platform !== 'darwin') return undefined;
  const child = o.spawn('caffeinate', ['-i', '-w', String(o.pid)], { stdio: 'ignore' });
  child.on('error', (err) => o.log('caffeinate did not start; the Mac may idle-sleep', err));
  child.unref();
  return child;
}
