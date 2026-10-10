#!/usr/bin/env node
// Starts a build on its own and walks the path a person takes: sign in, open a shell, type, close it.
// APP is the build to try, PORT a free port, SMOKE_HOME an empty folder it may fill.
// Exits 0 only when every step worked. `workoffdesk deploy` runs it before switching to a new build.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const { APP, PORT, SMOKE_HOME } = process.env;
if (!APP || !PORT || !SMOKE_HOME) {
  console.error('Usage: APP=<build folder> PORT=<free port> SMOKE_HOME=<empty folder> node scripts/smoke.mjs');
  process.exit(2);
}
const cli = join(APP, 'dist/server/cli.js');
const origin = `http://localhost:${PORT}`;
const base = `http://127.0.0.1:${PORT}`;
const password = 'smoke test passphrase';
const { version } = createRequire(import.meta.url)(join(APP, 'package.json'));
const require = createRequire(join(APP, 'node_modules/'));
const WebSocket = require(require.resolve('ws', { paths: [join(APP, 'node_modules/.pnpm/node_modules'), join(APP, 'node_modules')] }));
const { envForHome, tmuxSocketFor } = await import(join(APP, 'dist/server/system/paths.js'));
const env = envForHome(process.env, SMOKE_HOME);
const { Tmux } = await import(join(APP, 'dist/server/system/tmux.js'));

let server;
let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed = true;
  return ok;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function finish() {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((r) => server.once('exit', r));
  }
  await new Tmux({ socket: tmuxSocketFor(SMOKE_HOME), conf: '/dev/null' }).killServer().catch(() => {});
  process.exit(failed ? 1 : 0);
}
setTimeout(() => {
  check('finished within 60 seconds', false);
  void finish();
}, 60_000).unref();

async function run() {
  // Its own port, so it never reaches for the one the running service holds.
  writeFileSync(join(SMOKE_HOME, 'config.json'), JSON.stringify({ origin, port: Number(PORT) }));
  const setup = spawnSync(process.execPath, [cli, 'setup', '--username', 'smoke'], { env, input: `${password}\n`, encoding: 'utf8' });
  if (!check('setup', setup.status === 0, setup.stderr.trim())) return;

  server = spawn(process.execPath, [cli, 'serve'], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  let health;
  for (let i = 0; i < 60 && server.exitCode === null; i++) {
    health = await fetch(`${base}/healthz`).then((r) => r.json(), () => null);
    if (health) break;
    await sleep(250);
  }
  if (!check('serve is up and /healthz reports this version', health?.ok === true && health.version === version, JSON.stringify(health))) return;

  check('home page', (await fetch(`${base}/`)).status === 200);
  await appUpdate();
  const login = await fetch(`${base}/api/auth/password`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'smoke', password }),
  });
  if (!check('sign in', login.ok, String(login.status))) return;
  const headers = { origin, cookie: login.headers.get('set-cookie').split(';')[0] };

  const created = await fetch(`${base}/api/m/local/sessions`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'shell', cwd: SMOKE_HOME }),
  });
  const { id } = await created.json();
  if (!check('create a session', created.ok && typeof id === 'string', String(created.status))) return;

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/m/local/sessions/${id}/ws`, { headers });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await sleep(1500);
  ws.send(Buffer.from('echo "smoke=$((40+2))"\r'));
  let typed = false;
  for (let i = 0; i < 20 && !typed; i++) {
    await sleep(250);
    const screen = await (await fetch(`${base}/api/m/local/sessions/${id}/screen`, { headers })).json();
    typed = /smoke=42/.test(screen.text);
  }
  check('typing shows up on the screen', typed);
  ws.close();

  const journal = await fetch(`${base}/api/m/local/sessions/${id}/journal?v=0`, { headers }).then((r) => r.json(), () => null);
  check('a copy starting over is given the journal', typeof journal?.epoch === 'string' && journal.reset === true && Array.isArray(journal.rows), JSON.stringify(journal)?.slice(0, 200));

  const killed = await fetch(`${base}/api/m/local/sessions/${id}`, { method: 'DELETE', headers });
  check('delete the session', killed.ok, String(killed.status));
}

// What a phone asks: the update for the runtime this build has one for, each file whole.
async function appUpdate() {
  const built = join(APP, 'dist/app-update/ios/update.json');
  const runtime = existsSync(built) ? JSON.parse(readFileSync(built, 'utf8')).runtimeVersion : 'no-such-runtime';
  const res = await fetch(`${base}/api/app-update/manifest`, {
    headers: { 'expo-protocol-version': '1', 'expo-platform': 'ios', 'expo-runtime-version': runtime },
  });
  if (!existsSync(built)) {
    check('no app update offered', res.status === 204, String(res.status));
    return;
  }
  if (!check('app update manifest', res.status === 200 && res.headers.get('expo-protocol-version') === '1', String(res.status))) return;
  const manifest = await res.json();
  const files = [manifest.launchAsset, ...manifest.assets];
  const broken = [];
  for (const a of files) {
    const bytes = Buffer.from(await (await fetch(a.url)).arrayBuffer());
    if (createHash('sha256').update(bytes).digest('base64url') !== a.hash) broken.push(a.key);
  }
  check(`app update files match their hashes (${files.length})`, broken.length === 0, broken.join(' '));
}

run().then(finish, (e) => {
  check('nothing threw', false, e?.stack ?? String(e));
  return finish();
});
