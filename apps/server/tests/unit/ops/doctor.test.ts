import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatChecks, runDoctor, type DoctorDeps } from '../../../src/ops/doctor.js';
import { Store } from '../../../src/system/store.js';

// A home the way setup leaves it: a config and a user.
const setUpHome = (origin = 'https://workoffdesk.example.com') => {
  const home = mkdtempSync(join(tmpdir(), 'ts-doctor-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ origin, port: 7681 }));
  new Store(join(home, 'state.json')).update((s) => {
    s.user = { username: 'me', hash: 'x' };
  });
  return home;
};

const deps = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
  platform: 'darwin',
  nodeVersion: '22.13.0',
  home: setUpHome(),
  claudeBin: 'claude',
  codexBin: null,
  version: '3.0.0',
  launchAgents: mkdtempSync(join(tmpdir(), 'ts-doctor-agents-')),
  run: async (cmd) => ({ ok: true, out: cmd === 'tmux' ? 'tmux 3.5a' : '2.1.0 (Claude Code)' }),
  fetch: async () => ({ ok: true, version: '3.0.0' }),
  ...over,
});

const check = async (d: DoctorDeps, id: string) => (await runDoctor(d)).find((c) => c.id === id);

describe('runDoctor', () => {
  it('passes everything on a set-up Mac', async () => {
    const checks = await runDoctor(deps());
    expect(checks.map((c) => c.id)).toEqual(['macos', 'node', 'tmux', 'claude', 'codex', 'setup', 'service', 'origin', 'sleep', 'apns']);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  });

  it.each([
    ['linux', { platform: 'linux' as const }, 'macos'],
    ['an old node', { nodeVersion: '22.12.0' }, 'node'],
    ['node 21', { nodeVersion: '21.9.0' }, 'node'],
    ['tmux 3.2a', { run: async (c: string) => ({ ok: true, out: c === 'tmux' ? 'tmux 3.2a' : 'x' }) }, 'tmux'],
    ['a tmux that does not say its version', { run: async (c: string) => ({ ok: true, out: c === 'tmux' ? 'tmux master' : 'x' }) }, 'tmux'],
    ['no tmux', { run: async (c: string) => ({ ok: c !== 'tmux', out: '' }) }, 'tmux'],
    ['no claude', { run: async (c: string) => ({ ok: c === 'tmux', out: 'tmux 3.5a' }) }, 'claude'],
    ['a service that is down', { fetch: async (u: string) => ({ ok: !u.startsWith('http://127.0.0.1:7681/') }) }, 'service'],
    ['an address that does not reach it', { fetch: async (u: string) => ({ ok: !u.startsWith('https://workoffdesk.example.com/') }) }, 'origin'],
  ])('fails the check on %s and says what to do', async (_, over, id) => {
    const c = await check(deps(over), id);
    expect(c?.ok).toBe(false);
    expect(c?.fix).toBeTruthy();
  });

  it('passes codex either way, saying its version or that it is optional', async () => {
    expect(await check(deps({ codexBin: '/bin/codex', run: async (c) => ({ ok: true, out: c === '/bin/codex' ? 'codex-cli 0.46.0\n' : 'tmux 3.5a' }) }), 'codex')).toEqual({
      id: 'codex',
      ok: true,
      detail: 'codex-cli 0.46.0',
    });
    expect(await check(deps(), 'codex')).toMatchObject({ ok: true, detail: 'not installed (optional: for Codex sessions)' });
    expect(await check(deps({ codexBin: '/bin/codex', run: async (c) => ({ ok: c !== '/bin/codex', out: 'tmux 3.5a' }) }), 'codex')).toMatchObject({ ok: true });
  });

  it('speaks the language it is given', async () => {
    const { zh } = await import('../../../src/system/messages.js');
    expect((await check(deps({ messages: zh }), 'codex'))?.detail).toBe(zh.doctor.noCodex);
  });

  it.each(['3.3', '3.5a', 'next-3.6', '10.0'])('takes tmux %s', async (v) => {
    expect((await check(deps({ run: async (c) => ({ ok: true, out: c === 'tmux' ? `tmux ${v}` : 'x' }) }), 'tmux'))?.ok).toBe(true);
  });

  it('asks the service on the port the config names, and says its version', async () => {
    const asked: string[] = [];
    const home = setUpHome();
    writeFileSync(join(home, 'config.json'), JSON.stringify({ origin: 'https://workoffdesk.example.com', port: 9000 }));
    const c = await check(deps({ home, fetch: async (u) => (asked.push(u), { ok: true, version: '3.0.1' }) }), 'service');
    expect(asked).toContain('http://127.0.0.1:9000/healthz');
    expect(c?.detail).toContain('3.0.1');
  });

  it('fails a service still running another version than this command, and says to restart it', async () => {
    const c = await check(deps({ version: '3.0.1', fetch: async () => ({ ok: true, version: '3.0.0' }) }), 'service');
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain('3.0.0');
    expect(c?.fix).toContain('launchctl kickstart -k');
  });

  describe('when the service does not answer', () => {
    const down = async (u: string) => ({ ok: !u.startsWith('http://127.0.0.1:7681/') });
    const withPlist = () => {
      const launchAgents = mkdtempSync(join(tmpdir(), 'ts-doctor-agents-'));
      writeFileSync(join(launchAgents, 'local.workoffdesk.plist'), '<plist/>');
      return launchAgents;
    };
    const launchctl = (loaded: boolean) => async (cmd: string, args: string[]) =>
      cmd === 'launchctl' ? { ok: loaded && args.join(' ') === 'list local.workoffdesk', out: '' } : { ok: true, out: cmd === 'tmux' ? 'tmux 3.5a' : 'x' };

    it('says to install it when it was never installed', async () => {
      const c = await check(deps({ fetch: down, run: launchctl(false) }), 'service');
      expect(c?.fix).toContain('workoffdesk install');
      expect(c?.fix).not.toContain('kickstart');
    });

    it('says to bootstrap the installed agent when launchd has not loaded it', async () => {
      const launchAgents = withPlist();
      const c = await check(deps({ fetch: down, launchAgents, run: launchctl(false) }), 'service');
      expect(c?.fix).toContain(`launchctl bootstrap gui/$(id -u) ${join(launchAgents, 'local.workoffdesk.plist')}`);
    });

    it('says to restart it, and where its startup errors go, when launchd has it loaded', async () => {
      const d = deps({ fetch: down, launchAgents: withPlist(), run: launchctl(true) });
      const c = await check(d, 'service');
      expect(c?.fix).toContain('launchctl kickstart -k gui/$(id -u)/local.workoffdesk');
      expect(c?.fix).toContain(join(d.home, 'logs', 'server.log'));
    });
  });

  it('fails setup with what to run on a Mac where setup never ran, and still checks the rest', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ts-doctor-'));
    const checks = await runDoctor(deps({ home }));
    const setup = checks.find((c) => c.id === 'setup');
    expect(setup?.ok).toBe(false);
    expect(setup?.fix).toContain('workoffdesk setup');
    expect(setup?.detail).toMatch(/^not set up yet/);
    expect(checks.map((c) => c.id)).toEqual(expect.arrayContaining(['macos', 'node', 'tmux', 'claude', 'apns']));
  });

  it('fails setup when there is a config but no user', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ts-doctor-'));
    writeFileSync(join(home, 'config.json'), JSON.stringify({ origin: 'https://workoffdesk.example.com' }));
    expect((await check(deps({ home }), 'setup'))?.ok).toBe(false);
  });

  it('says what is wrong with a config it cannot use', async () => {
    const home = setUpHome();
    writeFileSync(join(home, 'config.json'), JSON.stringify({ origin: 'http://workoffdesk.example.com' }));
    const c = await check(deps({ home }), 'setup');
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain('origin');
  });

  it('checks every address the site is reached at, and names the one that does not reach it', async () => {
    const home = setUpHome();
    writeFileSync(join(home, 'config.json'), JSON.stringify({ origin: 'https://workoffdesk.example.com', extraOrigins: ['https://relay.example.net'] }));
    const all = async (fetch: DoctorDeps['fetch']) => (await runDoctor(deps({ home, fetch }))).filter((c) => c.id === 'origin');
    expect(await all(async () => ({ ok: true }))).toEqual([
      { id: 'origin', ok: true, detail: 'https://workoffdesk.example.com' },
      { id: 'origin', ok: true, detail: 'https://relay.example.net' },
    ]);
    const [primary, extra] = await all(async (u) => ({ ok: !u.startsWith('https://relay.example.net/') }));
    expect(primary.ok).toBe(true);
    expect(extra).toMatchObject({ ok: false, detail: expect.stringContaining('https://relay.example.net') });
    expect(extra.fix).toContain('https://relay.example.net');
  });

  it('passes a local address without asking it, and says only this Mac reaches it', async () => {
    const asked: string[] = [];
    const c = await check(deps({ home: setUpHome('http://localhost:7681'), fetch: async (u) => (asked.push(u), { ok: true }) }), 'origin');
    expect(c?.ok).toBe(true);
    expect(c?.detail).toMatch(/only this Mac/i);
    expect(asked.filter((u) => u.startsWith('http://localhost'))).toEqual([]);
  });

  it('fails when the config lets the Mac idle-sleep, saying what that costs', async () => {
    const home = setUpHome();
    writeFileSync(join(home, 'config.json'), JSON.stringify({ origin: 'https://workoffdesk.example.com', preventSleep: false }));
    const c = await check(deps({ home }), 'sleep');
    expect(c?.ok).toBe(false);
    expect(c?.detail).toMatch(/sleep/);
    expect(c?.fix).toContain('preventSleep');
  });

  it('passes without a push key, saying what that means', async () => {
    const c = await check(deps(), 'apns');
    expect(c?.ok).toBe(true);
    expect(c?.detail).toMatch(/iPhone app/);
  });

  it('fails a push key it cannot read', async () => {
    const home = setUpHome();
    writeFileSync(join(home, 'apns.json'), JSON.stringify({ teamId: 'T', keyId: 'K', keyFile: join(home, 'nope.p8') }));
    const c = await check(deps({ home }), 'apns');
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain('keyFile');
    expect(c?.fix).toBeTruthy();
  });
});

describe('formatChecks', () => {
  it('marks each check and puts the fix under a failed one', () => {
    expect(
      formatChecks([
        { id: 'node', ok: true, detail: '22.13.0' },
        { id: 'tmux', ok: false, detail: 'not found', fix: 'brew install tmux' },
      ]),
    ).toBe('✓ node    22.13.0\n✗ tmux    not found\n          brew install tmux');
  });
});
