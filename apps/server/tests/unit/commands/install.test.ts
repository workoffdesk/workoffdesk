import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../../src/system/config.js';
import { checkNode, type InstallPlan, installService, renderCloudflaredYml, renderServicePlist, renderTunnelPlist, renderWrapper, servicePath } from '../../../src/commands/install.js';

// What install writes, called as the CLI calls it; cli.test runs the CLI itself.
const exe = (dir: string, name: string, body: string) => {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
};
const CONFIG: Config = { port: 7681, origin: 'https://workoffdesk.example.com', rpId: 'workoffdesk.example.com', pinnedDirs: [], serviceLabel: 'local.workoffdesk', claudeArgs: [], preventSleep: false };
const plan = (o: { cliBuilt?: boolean; tunnel?: boolean; credentials?: boolean } = {}): InstallPlan => {
  const root = mkdtempSync(join(tmpdir(), 'ts-install-'));
  const userHome = join(root, 'user');
  const cliPath = join(root, 'app', 'cli.js');
  if (o.cliBuilt ?? true) {
    mkdirSync(join(root, 'app'));
    writeFileSync(cliPath, '');
  }
  const id = '6f0c2a8e-1b2d-4c3e-9f4a-5b6c7d8e9f00';
  if (o.credentials) {
    mkdirSync(join(userHome, '.cloudflared'), { recursive: true });
    writeFileSync(join(userHome, '.cloudflared', `${id}.json`), '{}');
  }
  return {
    home: join(root, 'home'),
    config: CONFIG,
    userHome,
    agents: join(userHome, 'Library', 'LaunchAgents'),
    binDir: join(userHome, '.local', 'bin'),
    nodePath: '/opt/homebrew/bin/node',
    cliPath,
    shell: '/bin/zsh',
    ...(o.tunnel && { tunnel: { id, cloudflared: '/opt/homebrew/bin/cloudflared' } }),
  };
};

const lint = (xml: string) => {
  const f = join(mkdtempSync(join(tmpdir(), 'ts-plist-')), 'x.plist');
  writeFileSync(f, xml);
  execFileSync('plutil', ['-lint', f]);
  return JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', f], { encoding: 'utf8' }));
};

const home = '/Users/someone/.workoffdesk';

const TUNNEL = 'f56409bd-0000-4000-8000-000000000000';

describe('checkNode', () => {
  it('accepts the one named when it runs and is new enough', () => {
    expect(checkNode(process.execPath)).toBe(process.execPath);
  });

  it.each<[string, string, RegExp]>([
    ['is too old', 'echo 22.12.0', /is 22\.12\.0; WorkOffDesk needs node 22\.13 or later\./],
    ['does not run', 'exit 1', /does not run\./],
  ])('refuses it when it %s', (_, body, said) => {
    const node = exe(mkdtempSync(join(tmpdir(), 'ts-node-')), 'node', body);
    expect(() => checkNode(node)).toThrow(said);
  });
});

describe('renderWrapper', () => {
  it('runs the cli with the node and home it was installed with, whatever is in their paths', () => {
    const dir = mkdtempSync(join(tmpdir(), "ts-it's here "));
    const node = exe(dir, "no'de", 'printf "%s\\n" "$WORKOFFDESK_HOME" "$@"');
    const wrapper = join(dir, 'workoffdesk');
    writeFileSync(wrapper, renderWrapper({ nodePath: node, cliPath: join(dir, "cli $1 'x'.js"), home: join(dir, 'a "home"') }));
    chmodSync(wrapper, 0o755);
    expect(execFileSync(wrapper, ['status', 'two words']).toString().split('\n')).toEqual([join(dir, 'a "home"'), join(dir, "cli $1 'x'.js"), 'status', 'two words', '']);
  });
});

describe('installService', () => {
  it('writes its agent and the command, and the folder its log goes in, with nothing to warn of', () => {
    const p = plan();
    const r = installService(p);
    expect(r.written).toEqual([join(p.binDir, 'workoffdesk'), join(p.agents, 'local.workoffdesk.plist')]);
    expect(r.servicePlist).toBe(join(p.agents, 'local.workoffdesk.plist'));
    expect(r.tunnelPlist).toBeUndefined();
    expect(r.warnings).toEqual([]);
    expect(statSync(join(p.binDir, 'workoffdesk')).mode & 0o777).toBe(0o755);
    expect(existsSync(join(p.home, 'logs'))).toBe(true);
    expect(existsSync(join(p.home, 'cloudflared.yml'))).toBe(false);
  });

  it('warns when the cli it runs is not built yet', () => {
    const p = plan({ cliBuilt: false });
    expect(installService(p).warnings).toEqual([`Note: ${p.cliPath} does not exist yet; build first (pnpm build).`]);
  });

  it('writes the tunnel agent and its config for the host and port in the config', () => {
    const p = plan({ tunnel: true, credentials: true });
    const r = installService(p);
    expect(r.tunnelPlist).toBe(join(p.agents, 'local.workoffdesk-tunnel.plist'));
    expect(r.written).toEqual([join(p.binDir, 'workoffdesk'), r.servicePlist, r.tunnelPlist, join(p.home, 'cloudflared.yml')]);
    expect(r.warnings).toEqual([]);
    const yml = readFileSync(join(p.home, 'cloudflared.yml'), 'utf8');
    expect(yml).toContain(`credentials-file: ${join(p.userHome, '.cloudflared', `${p.tunnel!.id}.json`)}`);
    expect(yml).toContain('  - hostname: workoffdesk.example.com\n    service: http://127.0.0.1:7681\n');
  });

  it('warns when the tunnel was made on another machine, its credentials not here', () => {
    const p = plan({ tunnel: true, cliBuilt: false });
    expect(installService(p).warnings).toEqual([
      `Note: ${p.cliPath} does not exist yet; build first (pnpm build).`,
      `Note: the tunnel credentials ${join(p.userHome, '.cloudflared', `${p.tunnel!.id}.json`)} are not here; run the tunnel on the machine that created it.`,
    ]);
  });
});

describe('renderServicePlist and renderTunnelPlist', () => {
  it('runs the server with an absolute node, an explicit PATH and logs under home', () => {
    const p = lint(
      renderServicePlist({ label: 'com.example.workoffdesk', nodePath: '/opt/node/bin/node', cliPath: '/srv/workoffdesk/dist/server/cli.js', home, userHome: '/Users/someone', shell: '/bin/zsh' }),
    );
    expect(p.Label).toBe('com.example.workoffdesk');
    expect(p.ProgramArguments).toEqual(['/opt/node/bin/node', '/srv/workoffdesk/dist/server/cli.js', 'serve']);
    expect(p.KeepAlive).toBe(true);
    expect(p.RunAtLoad).toBe(true);
    expect(p.StandardOutPath).toBe(`${home}/logs/server.log`);
    expect(p.StandardErrorPath).toBe(`${home}/logs/server.log`);
    const path: string[] = p.EnvironmentVariables.PATH.split(':');
    expect(path).toContain('/opt/homebrew/bin');
    expect(path).toContain('/Users/someone/.local/bin');
    expect(path.some((d) => d.includes('node_modules'))).toBe(false);
    // Anything the server starts that asks for `node` gets the same one, not whatever ~/.local/bin holds.
    expect(path[0]).toBe('/opt/node/bin');
    expect(p.EnvironmentVariables.WORKOFFDESK_HOME).toBe(home);
    expect(p.EnvironmentVariables.SHELL).toBe('/bin/zsh');
    expect(p.EnvironmentVariables.LANG).toMatch(/UTF-8$/);
  });

  it('runs the tunnel from its own config file, never the default one', () => {
    const p = lint(renderTunnelPlist({ label: 'com.example.workoffdesk-tunnel', cloudflaredPath: '/opt/homebrew/bin/cloudflared', home }));
    expect(p.Label).toBe('com.example.workoffdesk-tunnel');
    expect(p.ProgramArguments).toEqual(['/opt/homebrew/bin/cloudflared', 'tunnel', '--config', `${home}/cloudflared.yml`, 'run']);
    expect(p.KeepAlive).toBe(true);
    expect(p.StandardErrorPath).toBe(`${home}/logs/tunnel.log`);
  });

  it('escapes paths that contain XML metacharacters', () => {
    const p = lint(renderServicePlist({ label: 'x', nodePath: '/a&b/<node>', cliPath: '/c/cli.js', home, userHome: '/Users/x', shell: '/bin/zsh' }));
    expect(p.ProgramArguments[0]).toBe('/a&b/<node>');
  });

  it('puts the plists in ~/Library/LaunchAgents', () => {
    expect(servicePath('/Users/x', 'com.example.workoffdesk')).toBe('/Users/x/Library/LaunchAgents/com.example.workoffdesk.plist');
  });
});

describe('renderCloudflaredYml', () => {
  const yml = renderCloudflaredYml({
    tunnelId: TUNNEL,
    credentialsFile: `/Users/x/.cloudflared/${TUNNEL}.json`,
    hostname: 'workoffdesk.example.com',
    port: 7681,
  });

  it('routes the hostname to the loopback port and ends with a 404 catch-all', () => {
    const lines = yml.trim().split('\n');
    expect(lines).toContain(`tunnel: ${TUNNEL}`);
    expect(lines).toContain(`credentials-file: /Users/x/.cloudflared/${TUNNEL}.json`);
    expect(yml).toContain('  - hostname: workoffdesk.example.com\n    service: http://127.0.0.1:7681\n');
    expect(lines.at(-1)).toBe('  - service: http_status:404');
  });

  it('connects over http2, which works through proxies that pass only TCP', () => {
    expect(yml.split('\n')).toContain('protocol: http2');
  });
});
