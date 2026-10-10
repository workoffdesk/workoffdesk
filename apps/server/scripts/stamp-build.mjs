#!/usr/bin/env node
// The build's last step: stamps dist with the version and commit it was built from, which `workoffdesk deploy`
// checks against the version it is asked to release. Runs after tsc, as it uses the compiled dist/server/ops/build.js.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('..', import.meta.url));
const { stampBuild } = await import(join(server, 'dist/server/ops/build.js'));
const { version, commit, dirty } = stampBuild(server);
console.log(`built ${version} from ${commit ?? 'outside git'}${dirty ? ' with uncommitted changes' : ''}`);
