import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { Tmux, TmuxTimeout } from '../../../src/system/tmux.js';
import { until } from '../../helpers/until.js';
import { testTmux } from '../../helpers/tmux.js';

const dir = mkdtempSync(join(tmpdir(), 'ts-tmux-'));
const { tmux, socket, conf } = testTmux(dir, 't');
const execFileAsync = promisify(execFile);

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

  // A command run by if-shell has no target of its own, and tmux would pick the newest session for it.
  it('leaves copy mode in the session asked for, whichever session is newest', async () => {
    const inMode = (name: string) => execFileAsync('tmux', ['-L', socket, 'display', '-p', '-t', `=${name}:`, '#{pane_in_mode}']).then((r) => r.stdout.trim());
    await tmux.newSession('ts-copy', { cwd: dir, env: {}, command: 'sleep 60' });
    await execFileAsync('tmux', ['-L', socket, 'copy-mode', '-t', '=ts-copy:']);
    await tmux.newSession('ts-newer', { cwd: dir, env: {}, command: 'sleep 60' });
    expect(await inMode('ts-copy')).toBe('1');
    await tmux.leaveCopyMode('ts-copy');
    expect(await inMode('ts-copy')).toBe('0');
    await tmux.leaveCopyMode('ts-newer');
    expect(await inMode('ts-newer')).toBe('0');
  });

  // macOS hands a pty the lowest free number: the one respawn-pane just let go of can come back while its old
  // device is still going away, and tmux then starts nothing and leaves the pane empty. tmux before 3.8 crashes
  // when such a pane is respawned again (docs/design/2026-10-16-respawn-without-a-pty.md).
  describe('when tmux gets no pty for a pane', () => {
    const PTY_LOST = 'fork failed: Device not configured';
    // A tmux whose respawn-pane and split-window fail as above their first `respawns` and `splits` times, a failed
    // respawn leaving the pane empty as tmux does; it counts each of the two it is given.
    const flaky = (name: string, fails: { respawns?: number; splits?: number }, said = PTY_LOST) => {
      const bin = join(dir, `tmux-${name}`);
      const count = (cmd: string) => join(dir, `${name}.${cmd}`);
      const tmuxHere = `tmux "$1" "$2" "$3" "$4"`;
      writeFileSync(
        bin,
        [
          '#!/bin/sh',
          'case "$5" in respawn-pane) limit=' + (fails.respawns ?? 0) + ' ;; split-window) limit=' + (fails.splits ?? 0) + ' ;; *) exec tmux "$@" ;; esac',
          `echo x >> "${dir}/${name}.$5"`,
          `if [ "$(wc -l < "${dir}/${name}.$5")" -gt $limit ]; then exec tmux "$@"; fi`,
          `if [ "$5" = respawn-pane ] && [ '${said}' = '${PTY_LOST}' ]; then`,
          `  ${tmuxHere} set-option -p -t "$8" remain-on-exit on`,
          `  ${tmuxHere} respawn-pane -k -t "$8" "exit 0"`,
          `  while [ "$(${tmuxHere} display-message -p -t "$8" '#{pane_dead}')" != 1 ]; do sleep 0.05; done`,
          'fi',
          `echo '${said}' >&2`,
          'exit 1',
          '',
        ].join('\n'),
      );
      chmodSync(bin, 0o755);
      const times = (cmd: string) => (existsSync(count(cmd)) ? readFileSync(count(cmd), 'utf8').split('\n').filter(Boolean).length : 0);
      return { t: new Tmux({ socket, conf, bin }), respawns: () => times('respawn-pane'), splits: () => times('split-window') };
    };
    const panes = (name: string) =>
      execFileAsync('tmux', ['-L', socket, 'list-panes', '-t', `=${name}:`, '-F', '#{pane_dead}']).then((r) => r.stdout.trim().split('\n'));
    const NEW = { cwd: dir, env: { MARK: '42' }, command: 'sh -c "echo new-$MARK; sleep 60"' };
    const runsNew = (name: string) => until(async () => (await tmux.capture(name, 50)).includes('new-42'));

    it('starts the command in a new pane in place of the one left empty, not respawning it again', async () => {
      const { t, respawns, splits } = flaky('pty-lost', { respawns: 1 });
      await tmux.newSession('ts-lost', { cwd: dir, env: {}, command: 'sleep 60' });
      await t.respawnPane('ts-lost', NEW);
      expect(await runsNew('ts-lost')).toBe(true);
      expect(await panes('ts-lost')).toEqual(['0']);
      expect([respawns(), splits()]).toEqual([1, 1]);
    });

    it('replaces a pane left empty before, without respawning it', async () => {
      const { t, respawns } = flaky('empty-before', {});
      await tmux.newSession('ts-empty', { cwd: dir, env: {}, command: 'sleep 60' });
      await execFileAsync('tmux', ['-L', socket, 'set-option', '-p', '-t', '=ts-empty:', 'remain-on-exit', 'on']);
      await execFileAsync('tmux', ['-L', socket, 'respawn-pane', '-k', '-t', '=ts-empty:', 'exit 0']);
      expect(await until(async () => (await panes('ts-empty'))[0] === '1')).toBe(true);
      await t.respawnPane('ts-empty', NEW);
      expect(await runsNew('ts-empty')).toBe(true);
      expect(await panes('ts-empty')).toEqual(['0']);
      expect(respawns()).toBe(0);
    });

    it('tries the new pane again when it gets no pty either', async () => {
      const { t, splits } = flaky('split-lost', { respawns: 1, splits: 2 });
      await tmux.newSession('ts-split-lost', { cwd: dir, env: {}, command: 'sleep 60' });
      await t.respawnPane('ts-split-lost', NEW);
      expect(await runsNew('ts-split-lost')).toBe(true);
      expect(await panes('ts-split-lost')).toEqual(['0']);
      expect(splits()).toBe(3);
    });

    it('gives up after a few tries, saying why, and leaves the session there', async () => {
      const { t, respawns, splits } = flaky('pty-gone', { respawns: 1000, splits: 1000 });
      await tmux.newSession('ts-gone', { cwd: dir, env: {}, command: 'sleep 60' });
      const e = await t.respawnPane('ts-gone', NEW).then(() => null, (err: unknown) => err);
      expect(String((e as { stderr?: string }).stderr)).toContain('fork failed');
      expect(respawns()).toBe(1);
      expect(splits()).toBeGreaterThan(1);
      expect(splits()).toBeLessThan(10);
      expect(await tmux.hasSession('ts-gone')).toBe(true);
    });

    it('does not start a new pane when the respawn failed for another reason', async () => {
      const { t, respawns, splits } = flaky('other-respawn', { respawns: 1 }, 'invalid option');
      await tmux.newSession('ts-other', { cwd: dir, env: {}, command: 'sleep 60' });
      await expect(t.respawnPane('ts-other', NEW)).rejects.toThrow();
      expect([respawns(), splits()]).toEqual([1, 0]);
    });

    it('does not try the new pane again when it failed for another reason', async () => {
      const { t, splits } = flaky('other-split', { respawns: 1, splits: 1000 }, PTY_LOST);
      const other = flaky('other-split-2', { splits: 1000 }, 'invalid option');
      await tmux.newSession('ts-other-split', { cwd: dir, env: {}, command: 'sleep 60' });
      await t.respawnPane('ts-other-split', NEW).catch(() => {});
      expect(splits()).toBeGreaterThan(1);
      await expect(other.t.respawnPane('ts-other-split', NEW)).rejects.toThrow();
      expect(other.splits()).toBe(1);
    });
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
