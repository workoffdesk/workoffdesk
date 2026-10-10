// The service as launchd has it: started, stopped, restarted, and whether a process is it.

export type Exec = (cmd: string, args: string[], o?: { env?: NodeJS.ProcessEnv }) => Promise<{ code: number; out: string }>;
export type ServiceDeps = { uid: number; label: string; exec: Exec };

const target = (d: ServiceDeps) => `gui/${d.uid}/${d.label}`;

async function launchctl(d: ServiceDeps, args: string[]): Promise<void> {
  const r = await d.exec('launchctl', args);
  if (r.code !== 0) throw new Error(r.out.trim() || `launchctl ${args[0]} failed (${r.code})`);
}

const loaded = async (d: ServiceDeps) => (await d.exec('launchctl', ['print', target(d)])).code === 0;
const pidOf = async (d: ServiceDeps) => /\bpid = (\d+)/.exec((await d.exec('launchctl', ['print', target(d)])).out)?.[1];

// Loads the agent install wrote, or starts the one launchd has.
export async function startService(d: ServiceDeps, plist: string): Promise<void> {
  if (await loaded(d)) await launchctl(d, ['kickstart', target(d)]);
  else await launchctl(d, ['bootstrap', `gui/${d.uid}`, plist]);
}

// Unloaded rather than killed: KeepAlive would start a killed one again.
export async function stopService(d: ServiceDeps): Promise<void> {
  if (await loaded(d)) await launchctl(d, ['bootout', target(d)]);
}

// How long the running service is given to close on its own (it allows itself 10 s), and how often it is looked at.
const STOP_WAIT_MS = 12_000;
const STOP_POLL_MS = 250;

// The service is asked to stop with SIGTERM, so it tells the phones it is restarting and closes cleanly
// (kickstart -k kills it outright), then started at once rather than after launchd's throttle. Only one
// that will not stop is killed.
export async function restartService(d: ServiceDeps): Promise<void> {
  const was = await pidOf(d);
  if (was) {
    await d.exec('launchctl', ['kill', 'SIGTERM', target(d)]);
    for (let t = 0; t < STOP_WAIT_MS && (await pidOf(d)) === was; t += STOP_POLL_MS) await new Promise((r) => setTimeout(r, STOP_POLL_MS));
  }
  const stuck = was !== undefined && (await pidOf(d)) === was;
  await d.exec('launchctl', ['kickstart', ...(stuck ? ['-k'] : []), target(d)]);
}

// launchd tells a job its own label in XPC_SERVICE_NAME; a server started by hand has another or none.
export const isManaged = (env: NodeJS.ProcessEnv, label: string) => env.XPC_SERVICE_NAME === label;
