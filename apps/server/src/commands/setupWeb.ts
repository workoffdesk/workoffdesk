import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { runDoctor } from '../ops/doctor.js';
import { healthOn } from '../ops/release.js';
import { startService, type ServiceDeps } from '../ops/service.js';
import { loadConfig } from '../system/config.js';
import { m } from '../system/messages.js';
import { homeDir } from '../system/paths.js';
import { HEALTH_WAIT_MS, WEB_DIR, exec, which } from './common.js';
import { doctorDeps } from './doctor.js';
import { installPlan, installService } from './install.js';
import { tailscaleOf, tunnelsOf } from './wizard/probe.js';
import { buildWizard, type Remote } from './wizard/server.js';

const TAILSCALE_APP = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
// The Mac App Store's Tailscale puts no command on PATH; its app carries one.
const tool = (name: string) => which(name) ?? (name === 'tailscale' && existsSync(TAILSCALE_APP) ? TAILSCALE_APP : undefined);

const stdoutOf = (cmd: string, args: string[]) =>
  new Promise<string | null>((done) => execFile(cmd, args, { timeout: 10_000 }, (err, stdout) => done(err ? null : stdout)));

async function probeRemote(): Promise<Remote> {
  const tailscale = tool('tailscale');
  const cloudflared = tool('cloudflared');
  const [ts, cf] = await Promise.all([
    tailscale ? stdoutOf(tailscale, ['status', '--json']) : null,
    cloudflared ? stdoutOf(cloudflared, ['tunnel', 'list', '--output', 'json']) : null,
  ]);
  return { tailscale: tailscale ? tailscaleOf(ts) : null, cloudflared: cloudflared ? { tunnels: tunnelsOf(cf) } : null };
}

// The wizard's service step: what install writes, the tunnel's DNS record, both agents started, and the
// service waited for.
async function installFromWizard(home: string, tunnelName: string | undefined): Promise<{ ok: boolean; message: string }> {
  try {
    const config = loadConfig(home);
    const plan = installPlan(tunnelName ? ['--tunnel', tunnelName] : [], home, config);
    const { warnings, servicePlist, tunnelPlist } = installService(plan);
    const d: ServiceDeps = { uid: process.getuid!(), label: config.serviceLabel, exec };
    if (plan.tunnel && tunnelName && tunnelPlist) {
      const route = await exec(plan.tunnel.cloudflared, ['tunnel', '--config', join(home, 'cloudflared.yml'), 'route', 'dns', tunnelName, new URL(config.origin).hostname]);
      // A record the hostname already has is left as it is, as cloudflared does.
      if (route.code !== 0 && !/already exists/i.test(route.out)) return { ok: false, message: m.wizard.routeFailed(route.out.trim()) };
      await startService({ ...d, label: `${config.serviceLabel}-tunnel` }, tunnelPlist);
    }
    await startService(d, servicePlist);
    const up = await healthOn(config.port, HEALTH_WAIT_MS)(null);
    return { ok: up, message: [up ? m.ops.started(config.port) : m.ops.notUp(join(home, 'logs/server.log')), ...warnings].join('\n') };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

const WIZARD_IDLE_MS = 30 * 60_000;

// The first install in the browser (wizard/server.ts), on loopback at a free port, guarded by a token that
// travels in the address's fragment.
export async function setupWeb() {
  const home = homeDir();
  const token = randomBytes(24).toString('base64url');
  let host = '';
  let idle: ReturnType<typeof setTimeout> | undefined;
  const end = (message: string) => {
    clearTimeout(idle);
    console.log(message);
    void app.close().finally(() => process.exit(0));
  };
  const app = await buildWizard({
    home,
    webDir: WEB_DIR,
    token,
    host: () => host,
    doctor: () => runDoctor(doctorDeps(home)),
    probe: probeRemote,
    run: (cmd, args) => exec(tool(cmd) ?? cmd, args),
    install: (o) => installFromWizard(home, o.tunnel),
    // After the answer has gone out.
    onDone: () => setTimeout(() => end(m.wizard.done), 200),
    touch: () => {
      clearTimeout(idle);
      idle = setTimeout(() => end(m.wizard.idle), WIZARD_IDLE_MS);
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  host = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const url = `http://${host}/setup#${token}`;
  console.log(m.wizard.open(url));
  execFile('open', [url], () => {});
  idle = setTimeout(() => end(m.wizard.idle), WIZARD_IDLE_MS);
}
