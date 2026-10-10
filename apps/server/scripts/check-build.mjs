#!/usr/bin/env node
// Runs before npm packs: npm would publish whatever dist holds as package.json's version, so a dist built
// for another version, or by a build that did not finish, is refused.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(server, 'package.json'), 'utf8'));
const compiled = join(server, 'dist/server/ops/build.js');
// A dist with no build.js is from before builds were stamped, or from a build that stopped before tsc.
const stale = existsSync(compiled) ? (await import(compiled)).staleBuild(server) : { version, built: null };
if (stale) {
  console.error(`package.json says ${stale.version}, but dist ${stale.built ? `was built for ${stale.built}` : 'is not from a build that finished'}; run pnpm build again`);
  process.exit(1);
}
