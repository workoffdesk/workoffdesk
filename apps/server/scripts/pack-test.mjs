#!/usr/bin/env node
// Packs workoffdesk the way npm would publish it, installs the tarball into a throwaway prefix,
// sets it up in a throwaway home and checks that it serves. Needs the npm registry for the dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'workoffdesk-pack-'));
const prefix = join(tmp, 'prefix');
const env = { ...process.env, HOME: join(tmp, 'home'), WORKOFFDESK_HOME: join(tmp, 'ts') };
// The iPhone update is built only for a bundle id (see build-app-update.mjs); the published package has none.
const IOS_UPDATE = 'dist/app-update/ios/update.json';
const forIphone = !!process.env.WORKOFFDESK_IOS_BUNDLE_ID;
const MUST_SHIP = ['package.json', 'README.md', 'LICENSE', 'SECURITY.md', 'CHANGELOG.md', 'dist/server/cli.js', 'dist/web/index.html', 'dist/build.json', 'scripts/smoke.mjs', ...(forIphone ? [IOS_UPDATE] : [])];
const MUST_NOT_SHIP = forIphone ? /^(server|web|tests)\/|\.test\.|\.map$/ : /^(server|web|tests)\/|\.test\.|\.map$|^dist\/app-update\//;

let server;
function done(error) {
  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  if (error) {
    console.error(`PACK FAIL ${error}`);
    process.exit(1);
  }
  console.log(`PACK OK ${version}`);
  process.exit(0);
}

const run = (step, cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { cwd: app, encoding: 'utf8', ...o });
  if (r.status !== 0) done(`${step}: ${cmd} ${args.join(' ')} exited with ${r.status}\n${r.stderr || r.stdout}`);
  return r.stdout;
};

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

run('build', 'npm', ['run', 'build']);
const [packed] = JSON.parse(run('pack', 'npm', ['pack', '--json', '--pack-destination', tmp]));
const shipped = packed.files.map((f) => f.path);
const missing = MUST_SHIP.filter((f) => !shipped.includes(f));
if (missing.length) done(`contents: the package is missing ${missing.join(', ')}`);
const extra = shipped.filter((f) => MUST_NOT_SHIP.test(f));
if (extra.length) done(`contents: the package should not contain ${extra.slice(0, 5).join(', ')}`);

run('install', 'npm', ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', join(tmp, packed.filename)]);
const bin = join(prefix, 'bin/workoffdesk');
const port = await freePort();
run('setup', bin, ['setup', '--username', 't', '--origin', `http://localhost:${port}`], { env, input: 'pack test passphrase\n' });
const configFile = join(env.WORKOFFDESK_HOME, 'config.json');
writeFileSync(configFile, JSON.stringify({ ...JSON.parse(readFileSync(configFile, 'utf8')), port }));

server = spawn(bin, ['serve'], { env, detached: true, stdio: 'ignore' });
const until = Date.now() + 20_000;
let health = null;
while (Date.now() < until && !health) {
  health = await fetch(`http://127.0.0.1:${port}/healthz`).then((r) => (r.ok ? r.json() : null), () => null);
  if (!health) await new Promise((r) => setTimeout(r, 250));
}
if (!health) done('serve: /healthz did not answer 200 within 20 seconds');
if (health.version !== version) done(`serve: /healthz reports ${health.version}, the package is ${version}`);
done();
