import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../install.sh', import.meta.url));

// A Mac made of stand-ins: each command the script may run writes its name and arguments to a log.
// npm installs the package into a prefix of its own, whose bin is not on PATH, as with many node setups.
// tty: run it in a terminal (a pseudo-terminal from script(1)), as curl | sh does from one; setUp: a config is there.
function mac(o: { uname?: string; without?: string[]; tty?: boolean; setUp?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ts-install-'));
  const bin = join(root, 'bin');
  const prefix = join(root, 'npm-global');
  const log = join(root, 'log');
  mkdirSync(bin);
  writeFileSync(log, '');
  const tool = (dir: string, name: string, body = '') =>
    writeFileSync(join(dir, name), `#!/bin/sh\necho "${name} $*" >> '${log}'\n${body}\n`, { mode: 0o755 });
  const tools: Record<string, string> = {
    uname: `echo ${o.uname ?? 'Darwin'}`,
    brew: '',
    tmux: '',
    node: '',
    sudo: '',
    npm: `[ "$1" = prefix ] && echo '${prefix}'; [ "$1" = i ] && { /bin/mkdir -p '${prefix}/bin'; printf '#!/bin/sh\\necho "workoffdesk $*" >> ${log}\\n' > '${prefix}/bin/workoffdesk'; /bin/chmod +x '${prefix}/bin/workoffdesk'; }; true`,
  };
  for (const [name, body] of Object.entries(tools)) if (!o.without?.includes(name)) tool(bin, name, body);
  if (o.setUp) {
    mkdirSync(join(root, '.workoffdesk'));
    writeFileSync(join(root, '.workoffdesk/config.json'), '{}');
  }
  const r = o.tty
    ? spawnSync('/usr/bin/script', ['-q', '/dev/null', '/bin/sh', SCRIPT], { env: { PATH: bin, HOME: root }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    : spawnSync('/bin/sh', [SCRIPT], { env: { PATH: bin, HOME: root }, encoding: 'utf8' });
  const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  return { ...r, out: r.stdout + r.stderr, calls, prefix };
}

describe('install.sh', () => {
  it('installs the package, then checks the Mac, then says how to set it up', () => {
    const r = mac();
    expect(r.status).toBe(0);
    const order = r.calls.filter((c) => /^(npm i|workoffdesk)/.test(c));
    expect(order).toEqual(['npm i -g workoffdesk', 'workoffdesk doctor']);
    expect(r.out).toContain('workoffdesk setup --origin');
  });

  it('goes on to set it up in the browser when it runs in a terminal and nothing is set up', () => {
    const r = mac({ tty: true });
    expect(r.status).toBe(0);
    expect(r.calls.filter((c) => c.startsWith('workoffdesk'))).toEqual(['workoffdesk doctor', 'workoffdesk setup --web']);
  });

  it.each([
    ['without a terminal', { tty: false }],
    ['when it is set up already', { tty: true, setUp: true }],
  ])('only says how to set it up %s', (_, o) => {
    const r = mac(o);
    expect(r.calls.filter((c) => c.startsWith('workoffdesk'))).toEqual(['workoffdesk doctor']);
    expect(r.out).toContain('workoffdesk setup --web');
  });

  it('finds the command it installed even when npm puts it outside PATH, and says to add it', () => {
    const r = mac();
    expect(existsSync(join(r.prefix, 'bin/workoffdesk'))).toBe(true);
    expect(r.calls).toContain('workoffdesk doctor');
    expect(r.out).toContain(join(r.prefix, 'bin'));
  });

  it('stops on anything but a Mac, before installing anything', () => {
    const r = mac({ uname: 'Linux' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/macOS only/);
    expect(r.calls.filter((c) => /^(npm|brew)/.test(c))).toEqual([]);
  });

  it('stops without Homebrew and says how to get it, asking for no password', () => {
    const r = mac({ without: ['brew'] });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('https://brew.sh');
    expect(r.calls.filter((c) => /^(sudo|npm)/.test(c))).toEqual([]);
  });

  it.each(['tmux', 'node'])('installs %s from Homebrew only when it is missing', (name) => {
    expect(mac({ without: [name] }).calls).toContain(`brew install ${name}`);
    expect(mac().calls.filter((c) => c.startsWith('brew install'))).toEqual([]);
  });

  it('never asks for sudo', () => {
    expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(/\bsudo\b/);
  });
});
