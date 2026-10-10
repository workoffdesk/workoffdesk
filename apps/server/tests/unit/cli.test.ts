import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyPassword } from '../../src/http/auth/password.js';

const cliPath = join(__dirname, '../../src/cli.ts');
const cli = (args: string[], opts: { home: string; input?: string; env?: Record<string, string> }) =>
  spawnSync('npx', ['tsx', cliPath, ...args], {
    input: opts.input ?? '',
    encoding: 'utf8',
    env: { ...process.env, WORKOFFDESK_HOME: opts.home, ...opts.env },
    timeout: 60_000,
  });

const lint = (xml: string) => {
  const f = join(mkdtempSync(join(tmpdir(), 'ts-plist-')), 'x.plist');
  writeFileSync(f, xml);
  execFileSync('plutil', ['-lint', f]);
  return JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', f], { encoding: 'utf8' }));
};

// Stands in for `cloudflared tunnel list --output json`.
const fakeCloudflared = (tunnels: unknown[]) => {
  const f = join(mkdtempSync(join(tmpdir(), 'ts-cf-')), 'cloudflared');
  writeFileSync(f, `#!/bin/sh\n[ "$1 $2" = "tunnel list" ] && echo '${JSON.stringify(tunnels)}'\n`);
  chmodSync(f, 0o755);
  return f;
};
const TUNNEL = 'f56409bd-0000-4000-8000-000000000000';
const SITE = 'https://workoffdesk.example.com';

const fakeExe = (dir: string, name: string, body: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
  return join(dir, name);
};
const installEnv = (extra: Record<string, string> = {}) => {
  const agents = mkdtempSync(join(tmpdir(), 'ts-agents-'));
  const bin = mkdtempSync(join(tmpdir(), 'ts-bin-'));
  return { agents, bin, args: ['install', '--launch-agents-dir', agents, '--bin-dir', bin], env: extra };
};

describe('workoffdesk --version', () => {
  it.each(['--version', '-v'])('prints the version of the package and nothing else, as %s', (flag) => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { version: string };
    const r = cli([flag], { home: mkdtempSync(join(tmpdir(), 'ts-cli-')) });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`${pkg.version}\n`);
  });
});

describe('workoffdesk status', () => {
  // What the menu bar app (apps/mac, Status.swift) decodes; a field renamed here breaks it there.
  it('answers what the menu bar app reads with --json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-cli-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ origin: SITE, port: 7700 }));
    mkdirSync(join(dir, 'logs'));
    writeFileSync(join(dir, 'logs/workoffdesk.log'), `${JSON.stringify({ level: 50, time: 1, msg: 'boom', pid: 9 })}\n`);
    const r = cli(['status', '--json'], { home: dir });
    expect(r.status, r.stderr).toBe(0);
    const s = JSON.parse(r.stdout);
    expect(Object.keys(s).sort()).toEqual(['build', 'checks', 'home', 'lastOp', 'origin', 'port', 'problems', 'release', 'releases', 'rollbackTo', 'running', 'version'].sort());
    expect(s).toMatchObject({ home: dir, origin: SITE, port: 7700, running: false, problems: [{ level: 'error', msg: 'boom' }] });
    expect(s.checks.find((c: { id: string }) => c.id === 'origin')).toMatchObject({ ok: expect.any(Boolean), detail: expect.any(String) });
  });

  it('says without --json that it is for the menu bar app', () => {
    const r = cli(['status'], { home: mkdtempSync(join(tmpdir(), 'ts-cli-')) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--json');
  });
});

describe('workoffdesk deploy', () => {
  // A flag mistyped is not dropped: the deploy it was meant to allow would go ahead without it, or one it
  // was not meant for with it.
  it.each([[[]], [['--new-app-runtime']], [['build', '--new-app-runtme']], [['build', '--new-app-runtime', '-f']]])(
    'says how it is used and deploys nothing for %j',
    (args) => {
      const dir = mkdtempSync(join(tmpdir(), 'ts-cli-'));
      const r = cli(['deploy', ...args], { home: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('workoffdesk deploy <build folder> [--new-app-runtime]');
      expect(existsSync(join(dir, 'releases'))).toBe(false);
    },
  );
});

describe('workoffdesk serve', () => {
  // 78 is EX_CONFIG: what is wrong is the setup, and starting again will not change that.
  it('refuses to start before setup and says what to run', () => {
    const r = cli(['serve'], { home: mkdtempSync(join(tmpdir(), 'ts-cli-')) });
    expect(r.status).toBe(78);
    expect(r.stderr).toContain('workoffdesk setup');
  });

  it('refuses a config with a bad field, naming the field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-cli-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ origin: SITE, port: 'eighty' }));
    const r = cli(['serve'], { home: dir });
    expect(r.status).toBe(78);
    expect(r.stderr).toContain('port');
  });
});

describe('workoffdesk setup', () => {
  it('stores a verifiable password and the origin it is given', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-cli-'));
    const r = cli(['setup', '--username', 'alice', '--origin', SITE], { home: dir, input: 'a long enough passphrase\n' });
    expect(r.status, r.stderr).toBe(0);
    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
    expect(state.user.username).toBe('alice');
    expect(await verifyPassword('a long enough passphrase', state.user.hash)).toBe(true);
    const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    expect(config).toEqual({ port: 7681, origin: SITE, rpId: 'workoffdesk.example.com', pinnedDirs: [], serviceLabel: 'local.workoffdesk', claudeArgs: [], preventSleep: true });
  });

  it('says, without an origin and with no config yet, how to give one, and changes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-cli-'));
    const r = cli(['setup', '--username', 'alice'], { home: dir, input: 'a long enough passphrase\n' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--origin');
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
  });

  it('refuses an origin that is not a web address, and changes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-cli-'));
    const r = cli(['setup', '--username', 'alice', '--origin', 'workoffdesk.example.com'], { home: dir, input: 'a long enough passphrase\n' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('origin');
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
  });

  it('keeps the rpId passkeys were made for when given the same origin again; a new origin gets its own', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-cli-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ origin: SITE, rpId: 'example.com' }));
    cli(['setup', '--username', 'alice', '--origin', SITE], { home: dir, input: 'a long enough passphrase\n' });
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).rpId).toBe('example.com');
    const r = cli(['setup', '--username', 'alice', '--origin', 'https://term.other.test'], { home: dir, input: 'a long enough passphrase\n' });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).rpId).toBe('term.other.test');
  });

  it('keeps the config there is, other fields included, when run again without an origin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-cli-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ origin: SITE, port: 7700, claudeArgs: ['--chrome'] }));
    const r = cli(['setup', '--username', 'alice'], { home: dir, input: 'a long enough passphrase\n' });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))).toMatchObject({ origin: SITE, port: 7700, claudeArgs: ['--chrome'] });
  });

  it('ends every existing login when run again, so a leaked cookie dies with the old password', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-cli-'));
    cli(['setup', '--username', 'alice', '--origin', SITE], { home: dir, input: 'a long enough passphrase\n' });
    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
    state.logins = [{ id: 'stolen', method: 'password', createdAt: 1, lastSeenAt: 1, ua: 'x', ip: '1.2.3.4' }];
    writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
    const r = cli(['setup', '--username', 'alice', '--origin', SITE], { home: dir, input: 'a brand new passphrase\n' });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).logins).toEqual([]);
  });

  it('rejects a password shorter than 12 characters', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-cli-'));
    const r = cli(['setup', '--username', 'alice', '--origin', SITE], { home: dir, input: 'short\n' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('12');
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
  });

  it('writes the config it is given, with the default service label', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-cli-'));
    const r = cli(['setup', '--origin', 'https://x.example', '--username', 'a'], { home: dir, input: 'a long enough passphrase\n' });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))).toMatchObject({ origin: 'https://x.example', rpId: 'x.example', serviceLabel: 'local.workoffdesk' });
  });

  it('ends by saying what to run next', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-cli-'));
    const r = cli(['setup', '--origin', SITE, '--username', 'a'], { home: dir, input: 'a long enough passphrase\n' });
    expect(r.stdout).toContain('workoffdesk serve');
    expect(r.stdout).toContain('workoffdesk install');
    expect(r.stdout).toContain('SECURITY.md');
  });
});

describe('workoffdesk install', () => {
  const setUp = (config: Record<string, unknown> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'ts-cli-'));
    cli(['setup', '--username', 'alice', '--origin', SITE], { home: dir, input: 'a long enough passphrase\n' });
    if (Object.keys(config).length) {
      const file = join(dir, 'config.json');
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...config }));
    }
    return dir;
  };

  it('writes the service and the command without --tunnel, runs nothing, and says how to put a front door on', () => {
    const dir = setUp();
    const { agents, bin, args } = installEnv();
    const r = cli([...args, '--cloudflared', '/usr/bin/false'], { home: dir });
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(agents)).toEqual(['local.workoffdesk.plist']);
    const service = lint(readFileSync(join(agents, 'local.workoffdesk.plist'), 'utf8'));
    expect(service.Label).toBe('local.workoffdesk');
    expect(service.EnvironmentVariables.WORKOFFDESK_HOME).toBe(dir);
    expect(service.ProgramArguments[0]).toBe(process.execPath);
    expect(readFileSync(join(bin, 'workoffdesk'), 'utf8')).toContain(`exec '${process.execPath}' '${service.ProgramArguments[1]}' "$@"`);
    // A home other than the default must reach the command too, or it opens ~/.workoffdesk instead.
    expect(readFileSync(join(bin, 'workoffdesk'), 'utf8')).toContain(`WORKOFFDESK_HOME='${dir}'`);
    expect(existsSync(join(dir, 'cloudflared.yml'))).toBe(false);
    expect(r.stdout).toContain(`launchctl bootstrap gui/$(id -u) ${join(agents, 'local.workoffdesk.plist')}`);
    expect(r.stdout).toContain('--tunnel');
    expect(r.stdout).toContain('http://127.0.0.1:7681');
  });

  it('names the plists after the service label in the config', () => {
    const dir = setUp({ serviceLabel: 'com.example.workoffdesk' });
    const { agents, args } = installEnv();
    const cf = fakeCloudflared([{ id: TUNNEL, name: 'my-tunnel' }]);
    const r = cli([...args, '--cloudflared', cf, '--tunnel', 'my-tunnel'], { home: dir });
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(agents).sort()).toEqual(['com.example.workoffdesk-tunnel.plist', 'com.example.workoffdesk.plist']);
    expect(lint(readFileSync(join(agents, 'com.example.workoffdesk.plist'), 'utf8')).Label).toBe('com.example.workoffdesk');
    expect(lint(readFileSync(join(agents, 'com.example.workoffdesk-tunnel.plist'), 'utf8')).Label).toBe('com.example.workoffdesk-tunnel');
    expect(r.stdout).toContain('launchctl kickstart -k gui/$(id -u)/com.example.workoffdesk');
  });

  it('writes the tunnel files with --tunnel and prints the commands to run', () => {
    const dir = setUp();
    const { agents, args } = installEnv();
    const cf = fakeCloudflared([{ id: 'aaaaaaaa-0000-4000-8000-000000000000', name: 'killword' }, { id: TUNNEL, name: 'workoffdesk' }]);
    const r = cli([...args, '--cloudflared', cf, '--tunnel', 'workoffdesk'], { home: dir });
    expect(r.status, r.stderr).toBe(0);
    const tunnel = lint(readFileSync(join(agents, 'local.workoffdesk-tunnel.plist'), 'utf8'));
    expect(tunnel.ProgramArguments[0]).toBe(cf);
    const yml = readFileSync(join(dir, 'cloudflared.yml'), 'utf8');
    expect(yml).toContain(`tunnel: ${TUNNEL}`);
    expect(yml).toContain('hostname: workoffdesk.example.com');
    // Without --config, cloudflared takes the tunnel from ~/.cloudflared/config.yml, which may name another tunnel.
    expect(r.stdout).toContain(`cloudflared tunnel --config ${join(dir, 'cloudflared.yml')} route dns workoffdesk workoffdesk.example.com`);
    expect(r.stdout).toContain(`launchctl bootstrap gui/$(id -u) ${join(agents, 'local.workoffdesk.plist')}`);
    expect(r.stdout).toContain(`launchctl bootstrap gui/$(id -u) ${join(agents, 'local.workoffdesk-tunnel.plist')}`);
  });

  it('says to create a tunnel --tunnel names that does not exist, and writes nothing', () => {
    const dir = setUp();
    const { agents, args } = installEnv();
    const cf = fakeCloudflared([{ id: 'aaaaaaaa-0000-4000-8000-000000000000', name: 'killword' }]);
    const r = cli([...args, '--cloudflared', cf, '--tunnel', 'workoffdesk'], { home: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('cloudflared tunnel create workoffdesk');
    expect(readdirSync(agents)).toEqual([]);
  });

  it('names the node with --node for both the service and the command', () => {
    const dir = setUp();
    const other = fakeExe(mkdtempSync(join(tmpdir(), 'ts-node-')), 'node', 'echo 22.22.0');
    const { agents, bin, args } = installEnv();
    const r = cli([...args, '--node', other], { home: dir });
    expect(r.status, r.stderr).toBe(0);
    expect(lint(readFileSync(join(agents, 'local.workoffdesk.plist'), 'utf8')).ProgramArguments[0]).toBe(other);
    expect(readFileSync(join(bin, 'workoffdesk'), 'utf8')).toContain(`exec '${other}'`);
  });

  it.each([
    ['older than 22', 'echo 20.12.2', '20.12.2'],
    ['that does not run', 'exit 1', 'does not run'],
  ])('refuses and writes nothing when --node names a node %s', (_name, body, hint) => {
    const dir = setUp();
    const { agents, bin, args } = installEnv();
    const r = cli([...args, '--node', fakeExe(mkdtempSync(join(tmpdir(), 'ts-node-')), 'node', body)], { home: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(hint);
    expect(readdirSync(agents)).toEqual([]);
    expect(existsSync(join(bin, 'workoffdesk'))).toBe(false);
  });

  it('starts the service and the command through the app link when run from inside a release', () => {
    const dir = setUp();
    // This app's folder stands in for a release: the cli under test lives in releases/<this folder>/.
    symlinkSync(dirname(dirname(cliPath)) + '/..', join(dir, 'releases'));
    const { agents, bin, args } = installEnv();
    const r = cli(args, { home: dir });
    expect(r.status, r.stderr).toBe(0);
    const entry = join(dir, 'app/dist/server/cli.js');
    expect(lint(readFileSync(join(agents, 'local.workoffdesk.plist'), 'utf8')).ProgramArguments[1]).toBe(entry);
    expect(readFileSync(join(bin, 'workoffdesk'), 'utf8')).toContain(`'${entry}'`);
  });

  it('gives no advice about nvm or .nvmrc', () => {
    const dir = setUp();
    const { args } = installEnv();
    const r = cli(args, { home: dir });
    expect(r.status, r.stderr).toBe(0);
    expect(`${r.stdout}${r.stderr}`.replaceAll(process.execPath, '<node>')).not.toMatch(/nvm/);
  });
});
