import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveClaude, resolveCodex } from '../http/serve.js';
import { formatChecks, runDoctor, type DoctorDeps } from '../ops/doctor.js';
import { loadConfig } from '../system/config.js';
import { m } from '../system/messages.js';
import { homeDir } from '../system/paths.js';
import { VERSION } from '../system/version.js';
import { showQr } from './common.js';

export function doctorDeps(home: string): DoctorDeps {
  return {
    platform: process.platform,
    nodeVersion: process.versions.node,
    home,
    claudeBin: resolveClaude(),
    codexBin: resolveCodex(),
    version: VERSION,
    launchAgents: join(homedir(), 'Library/LaunchAgents'),
    run: (cmd, args) =>
      new Promise((done) => execFile(cmd, args, { timeout: 10_000 }, (err, stdout) => done({ ok: !err, out: stdout }))),
    fetch: async (url) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
        const body = res.ok ? ((await res.json().catch(() => null)) as { version?: string } | null) : null;
        return { ok: res.ok, version: body?.version };
      } catch {
        return { ok: false };
      }
    },
  };
}

export async function doctor() {
  const home = homeDir();
  const checks = await runDoctor(doctorDeps(home));
  console.log(formatChecks(checks));
  if (checks.find((c) => c.id === 'origin')?.ok) showQr(loadConfig(home).origin);
  if (checks.some((c) => !c.ok)) {
    console.log(`\n${m.doctor.failed}`);
    process.exit(1);
  }
}
