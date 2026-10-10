import { execFile, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { endOp, type OpKind } from '../ops/lastOp.js';
import { ACTIVATED, type Exec } from '../ops/release.js';
import { ConfigError, loadConfig, parseConfig, type Config } from '../system/config.js';
import { m } from '../system/messages.js';
import { originQr } from './qr.js';

// The package's parts, from this file: src/commands/ in the source, dist/server/commands/ in a build.
const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));
// The package folder: dist/server/commands/common.js is three below it in a build.
export const PACKAGE_ROOT = fromHere('../../../');
export const WEB_DIR = fromHere('../../web');
export const APP_UPDATE_DIR = fromHere('../../app-update/ios');
export const ACTIVATED_FILE = fromHere(`../../../${ACTIVATED}`);
// The CLI's entry; running from source (tsx), the built one.
export const CLI_ENTRY = fromHere(import.meta.url.endsWith('.ts') ? '../../dist/server/cli.js' : '../cli.js');

export const HEALTH_WAIT_MS = 30_000;

export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export function fail(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const ORIGIN_EXAMPLE = 'https://workoffdesk.example.com';

// The config setup will write: the one there is, with the origin replaced when one is given.
// With neither, a person at a terminal is asked for it until it is one that works.
export async function configForSetup(home: string, origin: string | undefined): Promise<Config> {
  const there = existsSync(join(home, 'config.json')) ? loadConfigOrFail(home) : null;
  if (!origin && there) return there;
  if (!origin && !process.stdin.isTTY) fail(m.cli.notConfigured(ORIGIN_EXAMPLE));
  for (;;) {
    const given = origin ?? (await ask(m.cli.askOrigin(ORIGIN_EXAMPLE))).trim();
    try {
      // Passkeys belong to the rpId, so it is kept unless the site moves to another address.
      return parseConfig({ ...there, origin: given, rpId: there?.origin === given ? there.rpId : undefined });
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      if (origin) fail(e.message);
      console.log(e.message);
    }
  }
}

export function loadConfigOrFail(home: string, code = 1): Config {
  try {
    return loadConfig(home);
  } catch (e) {
    if (e instanceof ConfigError) fail(e.message, code);
    throw e;
  }
}

export async function readStdinLine(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.split('\n')[0] ?? '';
}

export function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // Echo nothing after the prompt itself.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
      if (s.startsWith(question)) process.stdout.write(question);
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    }),
  );
}

export function which(name: string): string | undefined {
  const dirs = [...(process.env.PATH ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin'];
  return dirs.map((d) => join(d, name)).find(existsSync);
}

export const exec: Exec = (cmd, args, o) =>
  new Promise((done) => execFile(cmd, args, { env: o?.env }, (err, stdout, stderr) => done({ code: err ? Number(err.code) || 1 : 0, out: `${stdout}${stderr}` })));

// The CLI this server was started by, run apart from it: it outlives the server's restart, in a process
// group of its own, which launchd leaves alone when it stops the service.
export function spawnOp(home: string, op: OpKind): number {
  const out = openSync(join(home, 'logs/ops.log'), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [process.argv[1], op, '--record'], { detached: true, stdio: ['ignore', out, out] });
    child.unref();
    if (!child.pid) throw new Error(`could not start the ${op}`);
    return child.pid;
  } finally {
    closeSync(out);
  }
}

// A restart or rollback a screen asked for (routes/mac.ts) says how it ended in ops.json.
export const record = (args: string[], home: string, outcome: { ok: boolean; message: string }) => {
  if (args.includes('--record')) endOp(home, outcome);
};

export function showQr(origin: string) {
  const qr = originQr(origin);
  if (qr) console.log(`\n${m.cli.scan(origin)}\n${qr}`);
}
