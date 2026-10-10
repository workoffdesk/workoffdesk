import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Tmux, TmuxTimeout } from '../../../src/system/tmux.js';
import { until } from '../../helpers/until.js';
import { testTmux } from '../../helpers/tmux.js';

const dir = mkdtempSync(join(tmpdir(), 'ts-tmux-'));
const { tmux, conf } = testTmux(dir, 't');

afterAll(() => tmux.killServer());

async function realpath(p: string) {
  const { realpathSync } = await import('node:fs');
  writeFileSync(join(p, '.probe'), '');
  return realpathSync(p);
}

describe('Tmux', () => {
  it('returns no sessions when the server is not running', async () => {
    const idle = new Tmux({ socket: `workoffdesk-none-${process.pid}`, conf });
    expect(await idle.listSessions()).toEqual([]);
    expect(await idle.hasSession('ts-x')).toBe(false);
  });

  // The server goes away on its own once its last session ends, also while a list is being asked for.
  it.each(['no server running on /tmp/x', 'error connecting to /tmp/x (No such file or directory)', 'server exited unexpectedly'])(
    'returns no sessions when tmux says %s',
    async (said) => {
      const bin = join(dir, `tmux-${said.length}`);
      writeFileSync(bin, `#!/bin/sh\necho '${said}' >&2\nexit 1\n`);
      chmodSync(bin, 0o755);
      const gone = new Tmux({ socket: `workoffdesk-gone-${process.pid}`, conf, bin });
      expect(await gone.listSessions()).toEqual([]);
    },
  );

  it('creates a session in the given cwd with the given env', async () => {
    await tmux.newSession('ts-env', { cwd: dir, env: { WORKOFFDESK_SESSION: 'abc123' } });
    const names = (await tmux.listSessions()).map((s) => s.name);
    expect(names).toContain('ts-env');
    await tmux.sendKeys('ts-env', 'echo "cwd=$(pwd -P) id=$WORKOFFDESK_SESSION"');
    // The first shell on a fresh server reads the whole login profile, slow while other suites run.
    const ok = await until(async () => (await tmux.capture('ts-env', 50)).includes('id=abc123'), 15_000);
    expect(ok).toBe(true);
    const out = await tmux.capture('ts-env', 50);
    expect(out, out).toContain(`cwd=${await realpath(dir)} id=abc123`);
  });

  it('targets sessions by exact name, not by prefix', async () => {
    await tmux.newSession('ts-abcdef', { cwd: dir, env: {} });
    expect(await tmux.hasSession('ts-abc')).toBe(false);
    await tmux.killSession('ts-abc');
    expect(await tmux.hasSession('ts-abcdef')).toBe(true);
  });

  it('ends the session when its command exits', async () => {
    await tmux.newSession('ts-short', { cwd: dir, env: {}, command: 'sleep 0.2' });
    expect(await until(async () => !(await tmux.hasSession('ts-short')))).toBe(true);
  });

  it('captures output that scrolled far off screen', async () => {
    await tmux.newSession('ts-hist', { cwd: dir, env: {} });
    await tmux.sendKeys('ts-hist', 'seq 1 5000; echo done-$((1+1))');
    expect(await until(async () => (await tmux.capture('ts-hist', 10)).includes('done-2'))).toBe(true);
    const out = await tmux.capture('ts-hist', 10000);
    expect(out.split('\n')).toContain('42');
  });

  it('kills a session', async () => {
    await tmux.newSession('ts-kill', { cwd: dir, env: {} });
    await tmux.killSession('ts-kill');
    expect(await tmux.hasSession('ts-kill')).toBe(false);
  });

  // A tmux client waits on its server as long as that takes; on a starved machine, without end.
  describe('when tmux never answers', () => {
    // One script for all, as macOS is slow to start an executable the first time; each client it starts adds
    // its pid under the socket name it was given (`-L <socket>`). Reading the screen starts two at once.
    const bin = join(dir, 'tmux-stuck');
    writeFileSync(bin, `#!/bin/sh\necho $$ >> "${dir}/$2.pid"\nexec sleep 600\n`);
    chmodSync(bin, 0o755);
    let n = 0;
    const stuck = () => {
      const socket = `workoffdesk-stuck-${process.pid}-${n++}`;
      return { socket, bin, pids: () => readFileSync(join(dir, `${socket}.pid`), 'utf8').trim().split('\n').map(Number) };
    };
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    // Every client started, once the deadline has killed it and it has been reaped.
    const gone = (pids: () => number[]) => until(async () => pids().length > 0 && pids().every((p) => !alive(p)), 2_000);

    // Not "no sessions" or "no such session": a slow tmux says nothing about what it holds.
    it.each([
      ['reading the screen', (t: Tmux) => t.screenAndAbove('ts-x', 10)],
      ['listing sessions', (t: Tmux) => t.listSessions()],
      ['asking after a session', (t: Tmux) => t.hasSession('ts-x')],
      ['pasting', (t: Tmux) => t.paste('ts-x', 'hello')],
      ['ending a session', (t: Tmux) => t.killSession('ts-x')],
    ])('gives up %s at its deadline, saying it may have run, and leaves no client behind', async (_, call) => {
      const { socket, bin, pids } = stuck();
      const t = new Tmux({ socket, conf, bin, timeoutMs: 1_000 });
      const start = Date.now();
      const e = await call(t).then(() => null, (err: unknown) => err);
      expect(e).toBeInstanceOf(TmuxTimeout);
      expect((e as TmuxTimeout).mayHaveRun).toBe(true);
      expect(Date.now() - start).toBeLessThan(5_000);
      expect(await gone(pids)).toBe(true);
    });

    it('has a deadline when none is given', async () => {
      const { socket, bin, pids } = stuck();
      const t = new Tmux({ socket, conf, bin });
      await expect(t.screen('ts-x')).rejects.toBeInstanceOf(TmuxTimeout);
      expect(await gone(pids)).toBe(true);
    }, 30_000);

    it('tells it apart from a tmux that answered with an error', async () => {
      const bin = join(dir, 'tmux-fails');
      writeFileSync(bin, `#!/bin/sh\necho 'unknown command' >&2\nexit 1\n`);
      chmodSync(bin, 0o755);
      const t = new Tmux({ socket: `workoffdesk-fails-${process.pid}`, conf, bin, timeoutMs: 5_000 });
      const e = await t.paste('ts-x', 'hello').then(() => null, (err: unknown) => err);
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(TmuxTimeout);
    });
  });

  describe('when typing', () => {
    // launchd starts the server with no locale at all; tmux then turns every wide character into '_'
    // unless it is told the client speaks UTF-8.
    it.each([{}, { LANG: 'C' }, { LC_ALL: 'C', LANG: 'en_US.UTF-8' }])('carries CJK text to the program under locale %j', async (locale) => {
      const bare = new Tmux({
        socket: `workoffdesk-bare-${process.pid}-${Date.now()}`,
        conf,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, ...locale },
      });
      try {
        await bare.newSession('ts-cjk', { cwd: dir, command: '/bin/sh', env: {} });
        await new Promise((r) => setTimeout(r, 300));
        await bare.sendRaw('ts-cjk', 'printf "%s-done\\n" 你好\r');
        expect(await until(async () => (await bare.capture('ts-cjk', 50)).includes('-done'))).toBe(true);
        expect(await bare.capture('ts-cjk', 50)).toContain('你好-done');
      } finally {
        await bare.killServer();
      }
    });
  });
});
