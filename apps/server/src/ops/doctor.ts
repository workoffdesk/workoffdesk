import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ApnsConfigError, loadApnsKey } from '../notify/apns.js';
import { ConfigError, loadConfig, type Config } from '../system/config.js';
import { MIN_NODE, nodeTooOld } from '../system/node.js';
import { m, type Messages } from '../system/messages.js';
import { Store } from '../system/store.js';

// What a Mac needs for the service to work, each found out the way the service itself would meet it.

export type CheckId = 'macos' | 'node' | 'tmux' | 'claude' | 'codex' | 'setup' | 'service' | 'origin' | 'sleep' | 'apns';
export type Check = { id: CheckId; ok: boolean; detail: string; fix?: string };
export type DoctorDeps = {
  platform: NodeJS.Platform;
  nodeVersion: string;
  run: (cmd: string, args: string[]) => Promise<{ ok: boolean; out: string }>;
  home: string;
  claudeBin: string;
  // Codex is optional: its check says whether it is there and never fails.
  codexBin: string | null;
  // This command's own version, which a service started from the same install reports.
  version: string;
  // Where install writes the service's launchd agent.
  launchAgents: string;
  fetch: (url: string) => Promise<{ ok: boolean; version?: string }>;
  // The words, in the reader's language; the Mac's by default.
  messages?: Messages;
};

const MIN_TMUX = [3, 3];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const pass = (id: CheckId, detail: string): Check => ({ id, ok: true, detail });
const fail = (id: CheckId, detail: string, fix: string): Check => ({ id, ok: false, detail, fix });

function tmuxCheck(r: { ok: boolean; out: string }, d: Messages['doctor']): Check {
  if (!r.ok) return fail('tmux', d.notFound, d.tmuxFix);
  const v = /^tmux (?:next-)?(\d+)\.(\d+)/.exec(r.out.trim());
  const version = r.out.trim().replace(/^tmux /, '');
  if (!v) return fail('tmux', d.unknownVersion(version), d.tmuxFix);
  const [major, minor] = [Number(v[1]), Number(v[2])];
  if (major < MIN_TMUX[0] || (major === MIN_TMUX[0] && minor < MIN_TMUX[1])) return fail('tmux', d.tooOld(version, MIN_TMUX.join('.')), d.tmuxFix);
  return pass('tmux', version);
}

function setupCheck(home: string, doc: Messages['doctor']): { check: Check; config?: Config } {
  if (!existsSync(join(home, 'config.json'))) return { check: fail('setup', doc.notSetUp(home), doc.setupFix) };
  let config: Config;
  try {
    config = loadConfig(home);
  } catch (e) {
    if (e instanceof ConfigError) return { check: fail('setup', e.message, doc.setupFix) };
    throw e;
  }
  let user: string | undefined;
  try {
    user = new Store(join(home, 'state.json')).get().user?.username;
  } catch (e) {
    return { check: fail('setup', (e as Error).message, doc.setupFix), config };
  }
  return { check: user ? pass('setup', doc.setUp(user, config.origin)) : fail('setup', doc.noUser, doc.setupFix), config };
}

// How to get a service that does not answer going, from what launchd has of it.
async function startFix(d: DoctorDeps, doc: Messages['doctor'], label: string): Promise<string> {
  const plist = join(d.launchAgents, `${label}.plist`);
  if (!existsSync(plist)) return doc.installFix;
  if (!(await d.run('launchctl', ['list', label])).ok) return doc.bootstrapFix(plist);
  return doc.kickstartFix(label, join(d.home, 'logs', 'server.log'));
}

async function serviceChecks(d: DoctorDeps, doc: Messages['doctor'], config: Config): Promise<Check[]> {
  const local = `http://127.0.0.1:${config.port}`;
  const service = await d.fetch(`${local}/healthz`);
  const checks = [
    !service.ok
      ? fail('service', doc.notAnswering(local), await startFix(d, doc, config.serviceLabel))
      : service.version && service.version !== d.version
        ? fail('service', doc.otherVersion(local, service.version, d.version), doc.restartFix(config.serviceLabel))
        : pass('service', doc.running(local, service.version)),
  ];
  for (const origin of [config.origin, ...config.extraOrigins]) {
    if (LOCAL.test(origin)) {
      checks.push(pass('origin', doc.localOnly(origin)));
      continue;
    }
    const there = await d.fetch(`${origin}/healthz`);
    checks.push(there.ok ? pass('origin', origin) : fail('origin', doc.notReached(origin), doc.originFix(origin, local)));
  }
  return checks;
}

function apnsCheck(home: string, doc: Messages['doctor']): Check {
  try {
    const key = loadApnsKey(home);
    return pass('apns', key ? doc.apnsKey(key.keyId) : doc.noApns);
  } catch (e) {
    if (e instanceof ApnsConfigError) return fail('apns', e.message, doc.apnsFix(join(home, 'apns.json')));
    throw e;
  }
}

export async function runDoctor(d: DoctorDeps): Promise<Check[]> {
  const doc = (d.messages ?? m).doctor;
  const [tmux, claude, codex] = await Promise.all([
    d.run('tmux', ['-V']),
    d.run(d.claudeBin, ['--version']),
    d.codexBin ? d.run(d.codexBin, ['--version']) : Promise.resolve(null),
  ]);
  const { check: setup, config } = setupCheck(d.home, doc);
  return [
    d.platform === 'darwin' ? pass('macos', d.platform) : fail('macos', d.platform, doc.macosOnly),
    nodeTooOld(d.nodeVersion) ? fail('node', doc.tooOld(d.nodeVersion, MIN_NODE.join('.')), doc.nodeFix(MIN_NODE.join('.'))) : pass('node', d.nodeVersion),
    tmuxCheck(tmux, doc),
    claude.ok ? pass('claude', claude.out.trim()) : fail('claude', doc.notFound, doc.claudeFix),
    pass('codex', codex?.ok ? codex.out.trim() : doc.noCodex),
    setup,
    // Without a config there is no port or address to ask.
    ...(config ? await serviceChecks(d, doc, config) : []),
    ...(config ? [config.preventSleep ? pass('sleep', doc.awake) : fail('sleep', doc.sleepsOff, doc.sleepFix(join(d.home, 'config.json')))] : []),
    apnsCheck(d.home, doc),
  ];
}

const WIDTH = 8;

export function formatChecks(checks: Check[]): string {
  return checks
    .map((c) => `${c.ok ? '✓' : '✗'} ${c.id.padEnd(WIDTH)}${c.detail}${c.fix ? `\n${' '.repeat(2 + WIDTH)}${c.fix}` : ''}`)
    .join('\n');
}
