#!/usr/bin/env node
// Builds the iPhone app's JS into dist/app-update/ios, which the server offers to phones whose native
// runtime matches, for the app built with WORKOFFDESK_IOS_BUNDLE_ID. Runs after tsc, as it uses the compiled dist/server/ios-update/appUpdate.js.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The bundle id is the push topic the update's config hands the app, and part of its runtime: an update
// built without the builder's own id would reach no one's phone.
if (!process.env.WORKOFFDESK_IOS_BUNDLE_ID) {
  console.log('no iPhone update in this build: set WORKOFFDESK_IOS_BUNDLE_ID to the bundle id your iPhone app is built with');
  process.exit(0);
}

const server = fileURLToPath(new URL('..', import.meta.url));
const mobile = join(server, '../mobile');
const { writeAppUpdate } = await import(join(server, 'dist/server/ios-update/appUpdate.js'));
const { version } = JSON.parse(readFileSync(join(server, 'package.json'), 'utf8'));

const run = (args, o = {}) => {
  // Only what is installed here: never a copy npx would fetch.
  const r = spawnSync('npx', ['--no-install', ...args], { cwd: mobile, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...o });
  if (r.status !== 0) throw new Error(`npx ${args.join(' ')} failed\n${r.stderr}`);
  return r.stdout;
};

// The same resolution the app's Xcode build runs to stamp its binary.
const { runtimeVersion } = JSON.parse(run(['expo-updates', 'runtimeversion:resolve', '--platform', 'ios']));
if (typeof runtimeVersion !== 'string' || !runtimeVersion) throw new Error('the app has no runtime version; app.config.ts should set runtimeVersion');
const expoClient = JSON.parse(run(['expo', 'config', '--type', 'public', '--json']));
const exported = mkdtempSync(join(tmpdir(), 'workoffdesk-app-export-'));
try {
  run(['expo', 'export', '--platform', 'ios', '--output-dir', exported], { stdio: ['ignore', 'ignore', 'pipe'] });
  // The release goes with the update's config, for the app to say which one it runs.
  const config = { ...expoClient, extra: { ...expoClient.extra, release: version } };
  writeAppUpdate(exported, join(server, 'dist/app-update/ios'), { runtimeVersion, builtAt: new Date().toISOString(), expoClient: config });
} finally {
  rmSync(exported, { recursive: true, force: true });
}
console.log(`app update for iPhone runtime ${runtimeVersion}`);
