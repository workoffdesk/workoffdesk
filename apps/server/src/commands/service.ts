import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deploy, healthOn, rollback, type ReleaseDeps } from '../ops/release.js';
import { restartService, startService, stopService, type ServiceDeps } from '../ops/service.js';
import { m } from '../system/messages.js';
import { envForHome, homeDir } from '../system/paths.js';
import { HEALTH_WAIT_MS, exec, fail, loadConfigOrFail, record } from './common.js';
import { servicePath } from './install.js';

function freePort(): Promise<number> {
  return new Promise((done, reject) => {
    const s = createServer().once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => done(port));
    });
  });
}

// Runs the build's own smoke script against a throwaway home, with the node this command runs on.
async function smoke(appDir: string): Promise<boolean> {
  const home = mkdtempSync(join(tmpdir(), 'ts-smoke-'));
  try {
    const port = await freePort();
    const child = spawn(process.execPath, [join(appDir, 'scripts/smoke.mjs')], {
      env: { ...envForHome(process.env, home), APP: appDir, PORT: String(port), SMOKE_HOME: home },
      stdio: 'inherit',
    });
    return await new Promise<boolean>((done) => child.once('exit', (code) => done(code === 0)));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function releaseDeps(): ReleaseDeps {
  const home = homeDir();
  const config = loadConfigOrFail(home);
  return { home, label: config.serviceLabel, uid: process.getuid!(), exec, smoke, health: healthOn(config.port, HEALTH_WAIT_MS) };
}

function serviceDeps(): ServiceDeps & { home: string; port: number } {
  const home = homeDir();
  const config = loadConfigOrFail(home);
  return { home, port: config.port, label: config.serviceLabel, uid: process.getuid!(), exec };
}

export async function startCommand() {
  const d = serviceDeps();
  const plist = servicePath(homedir(), d.label);
  if (!existsSync(plist)) fail(m.doctor.installFix);
  await startService(d, plist).catch((e: Error) => fail(e.message));
  const up = await healthOn(d.port, HEALTH_WAIT_MS)(null);
  console.log(up ? m.ops.started(d.port) : m.ops.notUp(join(d.home, 'logs/server.log')));
  if (!up) process.exit(1);
}

export async function stopCommand() {
  await stopService(serviceDeps()).catch((e: Error) => fail(e.message));
  console.log(m.ops.stopped);
}

export async function restartCommand(args: string[]) {
  const d = serviceDeps();
  await restartService(d);
  const up = await healthOn(d.port, HEALTH_WAIT_MS)(null);
  const message = up ? m.ops.restarted : m.ops.notUp(join(d.home, 'logs/server.log'));
  record(args, d.home, { ok: up, message });
  console.log(message);
  if (!up) process.exit(1);
}

export async function deployCommand(args: string[]) {
  const [dir, ...flags] = args;
  if (!dir || dir.startsWith('-') || flags.some((f) => f !== '--new-app-runtime')) fail(m.cli.deployUsage);
  const r = await deploy(resolve(dir), releaseDeps(), { newAppRuntime: flags.includes('--new-app-runtime') });
  console.log(r.message);
  if (!r.ok) process.exit(1);
}

export async function rollbackCommand(args: string[]) {
  const d = releaseDeps();
  const r = await rollback(d);
  record(args, d.home, r);
  console.log(r.message);
  if (!r.ok) process.exit(1);
}
