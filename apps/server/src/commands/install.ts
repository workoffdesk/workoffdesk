import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { launchEntry } from '../ops/release.js';
import type { Config } from '../system/config.js';
import { m } from '../system/messages.js';
import { MIN_NODE, nodeTooOld } from '../system/node.js';
import { homeDir, writeFileAtomic } from '../system/paths.js';
import { CLI_ENTRY, fail, flag, loadConfigOrFail, which } from './common.js';

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function plist(label: string, args: string[], log: string, env: Record<string, string> = {}): string {
  const envXml = Object.entries(env)
    .map(([k, v]) => `      <key>${xml(k)}</key>\n      <string>${xml(v)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${xml(label)}</string>
    <key>ProgramArguments</key>
    <array>
${args.map((a) => `      <string>${xml(a)}</string>`).join('\n')}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>StandardOutPath</key>
    <string>${xml(log)}</string>
    <key>StandardErrorPath</key>
    <string>${xml(log)}</string>${
      envXml
        ? `
    <key>EnvironmentVariables</key>
    <dict>
${envXml}
    </dict>`
        : ''
    }
  </dict>
</plist>
`;
}

// launchd starts agents with PATH=/usr/bin:/bin:/usr/sbin:/sbin and no locale.
export function renderServicePlist(o: { label: string; nodePath: string; cliPath: string; home: string; userHome: string; shell: string }): string {
  const path = [dirname(o.nodePath), join(o.userHome, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  return plist(o.label, [o.nodePath, o.cliPath, 'serve'], join(o.home, 'logs/server.log'), {
    PATH: path.join(':'),
    WORKOFFDESK_HOME: o.home,
    SHELL: o.shell,
    LANG: 'en_US.UTF-8',
  });
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function renderWrapper(o: { nodePath: string; cliPath: string; home: string }): string {
  return `#!/bin/sh\n# Managed by workoffdesk install.\nexport WORKOFFDESK_HOME=${shellQuote(o.home)}\nexec ${shellQuote(o.nodePath)} ${shellQuote(o.cliPath)} "$@"\n`;
}

export function checkNode(node: string): string {
  let version: string;
  try {
    version = execFileSync(node, ['-p', 'process.versions.node'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error(m.node.doesNotRun(node));
  }
  if (nodeTooOld(version)) throw new Error(m.node.tooOld(node, version, MIN_NODE.join('.')));
  return node;
}

export function renderTunnelPlist(o: { label: string; cloudflaredPath: string; home: string }): string {
  return plist(
    o.label,
    [o.cloudflaredPath, 'tunnel', '--config', join(o.home, 'cloudflared.yml'), 'run'],
    join(o.home, 'logs/tunnel.log'),
  );
}

export function renderCloudflaredYml(o: { tunnelId: string; credentialsFile: string; hostname: string; port: number }): string {
  return `# Managed by workoffdesk install. The default ~/.cloudflared/config.yml is left alone.
tunnel: ${o.tunnelId}
credentials-file: ${o.credentialsFile}
protocol: http2

ingress:
  - hostname: ${o.hostname}
    service: http://127.0.0.1:${o.port}
  - service: http_status:404
`;
}

export function servicePath(userHome: string, label: string): string {
  return join(userHome, 'Library/LaunchAgents', `${label}.plist`);
}

export type InstallPlan = {
  home: string;
  config: Config;
  userHome: string;
  // Where the launchd agents and the workoffdesk command go.
  agents: string;
  binDir: string;
  nodePath: string;
  cliPath: string;
  shell: string;
  // An existing Cloudflare tunnel to run as an agent too.
  tunnel?: { id: string; cloudflared: string };
};

// What install writes, for the CLI to print and the setup wizard to start: the service's agent, the workoffdesk
// command, and with a tunnel its agent and config. Starts nothing.
export function installService(o: InstallPlan): { written: string[]; warnings: string[]; servicePlist: string; tunnelPlist?: string } {
  const label = o.config.serviceLabel;
  mkdirSync(o.agents, { recursive: true });
  mkdirSync(o.binDir, { recursive: true });
  mkdirSync(join(o.home, 'logs'), { recursive: true });
  const servicePlist = join(o.agents, `${label}.plist`);
  writeFileSync(servicePlist, renderServicePlist({ label, nodePath: o.nodePath, cliPath: o.cliPath, home: o.home, userHome: o.userHome, shell: o.shell }));
  const wrapper = join(o.binDir, 'workoffdesk');
  writeFileAtomic(wrapper, renderWrapper({ nodePath: o.nodePath, cliPath: o.cliPath, home: o.home }));
  chmodSync(wrapper, 0o755);
  const written = [wrapper, servicePlist];
  const warnings = [!existsSync(o.cliPath) && m.cli.notBuilt(o.cliPath)];
  let tunnelPlist: string | undefined;
  if (o.tunnel) {
    const tunnelLabel = `${label}-tunnel`;
    const credentialsFile = join(o.userHome, '.cloudflared', `${o.tunnel.id}.json`);
    tunnelPlist = join(o.agents, `${tunnelLabel}.plist`);
    writeFileSync(tunnelPlist, renderTunnelPlist({ label: tunnelLabel, cloudflaredPath: o.tunnel.cloudflared, home: o.home }));
    const yml = join(o.home, 'cloudflared.yml');
    writeFileAtomic(yml, renderCloudflaredYml({ tunnelId: o.tunnel.id, credentialsFile, hostname: new URL(o.config.origin).hostname, port: o.config.port }));
    written.push(tunnelPlist, yml);
    warnings.push(!existsSync(credentialsFile) && m.cli.noCredentials(credentialsFile));
  }
  return { written, warnings: warnings.filter((w): w is string => !!w), servicePlist, tunnelPlist };
}

function tunnelSetup(cloudflared: string, name: string) {
  const tunnels: { id: string; name: string }[] = JSON.parse(
    execFileSync(cloudflared, ['tunnel', 'list', '--output', 'json'], { encoding: 'utf8' }) || '[]',
  );
  const tunnel = tunnels.find((t) => t.name === name);
  if (!tunnel) throw new Error(m.cli.noTunnel(name));
  return tunnel;
}

// What install needs to know beyond the config: where node and the cli are, and the tunnel's id. Throws what
// is missing.
export function installPlan(args: string[], home: string, config: Config): InstallPlan & { tunnelName?: string } {
  const userHome = homedir();
  const tunnelName = flag(args, 'tunnel');
  const cloudflared = tunnelName ? (flag(args, 'cloudflared') ?? which('cloudflared')) : undefined;
  if (tunnelName && !cloudflared) throw new Error(m.cli.noCloudflared);
  const tunnel = cloudflared && tunnelName ? tunnelSetup(cloudflared, tunnelName) : undefined;
  const cliPath = launchEntry(CLI_ENTRY, home);
  const nodePath = checkNode(flag(args, 'node') ?? process.execPath);
  return {
    home,
    config,
    userHome,
    agents: flag(args, 'launch-agents-dir') ?? join(userHome, 'Library/LaunchAgents'),
    binDir: flag(args, 'bin-dir') ?? join(userHome, '.local/bin'),
    nodePath,
    cliPath,
    shell: process.env.SHELL || userInfo().shell || '/bin/zsh',
    tunnel: tunnel && cloudflared ? { id: tunnel.id, cloudflared } : undefined,
    tunnelName,
  };
}

export function install(args: string[]) {
  const home = homeDir();
  const config = loadConfigOrFail(home);
  let plan: ReturnType<typeof installPlan>;
  try {
    plan = installPlan(args, home, config);
  } catch (e) {
    fail((e as Error).message);
  }
  const { written, warnings, servicePlist, tunnelPlist } = installService(plan);
  const hostname = new URL(config.origin).hostname;
  const frontDoor = tunnelPlist
    ? `  cloudflared tunnel --config ${join(home, 'cloudflared.yml')} route dns ${plan.tunnelName} ${hostname}
  launchctl bootstrap gui/$(id -u) ${servicePlist}
  launchctl bootstrap gui/$(id -u) ${tunnelPlist}`
    : `  launchctl bootstrap gui/$(id -u) ${servicePlist}

${m.cli.frontDoor(config.port, config.origin)}`;
  console.log(m.cli.installed({ nodePath: plan.nodePath, written, warnings, frontDoor, label: config.serviceLabel }));
}
