import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { LocalMachine } from '../../../src/sessions/machine.js';
import { Store } from '../../../src/system/store.js';
import { fakeCodexAppServer } from '../../helpers/codexAppServer.js';
import { socketDir } from '../../helpers/socketDir.js';
import { alive } from '../../helpers/processes.js';
import { testTmux } from '../../helpers/tmux.js';

// Going on here with a Codex conversation people had on the Mac. The app server is a fake on a socket of the
// test's own, the locks are in a codex home of its own, and every Codex holding one is a process it started.
const dir = socketDir('mc');
const { tmux } = testTmux(dir, 'mc');
const exe = (name: string, body: string) => {
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
  return join(dir, name);
};
// Its TUI only waits; a Claude Code that lists no one open on the Mac.
const codexBin = exe('codex', 'exec sleep 600');
const claudeBin = exe('claude', `echo '[]'`);
const A = '0199aaaa-0000-7000-8000-00000000000a';

const started: ChildProcess[] = [];
const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const p of started.splice(0)) {
    try {
      process.kill(-p.pid!, 'SIGKILL');
    } catch {
      // gone already
    }
  }
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
afterAll(() => tmux.killServer());

const setup = async (o: { codex?: boolean } = {}) => {
  const at = mkdtempSync(join(dir, 'c-'));
  const home = join(at, 'codex');
  mkdirSync(join(home, 'thread-writer-locks'), { recursive: true });
  const rollout = join(at, 'rollout.jsonl');
  writeFileSync(rollout, '');
  const sock = join(at, 'sock');
  const server = await fakeCodexAppServer(sock, [{ id: A, cwd: at, name: 'Fix the login', source: 'cli', updatedAt: Date.now() / 1000, path: rollout }]);
  servers.push(server);
  const store = new Store(join(at, 'state.json'));
  const m = new LocalMachine({
    tmux,
    store,
    claudeSettingsPath: '/dev/null',
    claudeBin,
    shell: '/bin/sh',
    journal: { file: join(at, 'journal.db'), log: () => {} },
    ...(o.codex === false ? {} : { codex: { bin: codexBin, sock, home } }),
  });
  // A Codex holding the thread: node, as Codex is (ps shows no environment of the system's own programs).
  const holds = async (o: { args?: string[]; env?: Record<string, string>; ignoresTerm?: boolean } = {}) => {
    const lock = join(home, 'thread-writer-locks', `${A}.lock`);
    writeFileSync(lock, '');
    const fd = openSync(lock, 'r');
    const run = `${o.ignoresTerm ? "process.on('SIGTERM', () => {}); " : ''}console.log('ready'); setInterval(() => {}, 1000)`;
    const p = spawn(process.execPath, ['-e', run, ...(o.args ?? ['resume', A])], { stdio: ['ignore', 'pipe', 'ignore', fd], env: { PATH: '/bin:/usr/bin', ...o.env }, detached: true });
    closeSync(fd);
    started.push(p);
    await new Promise((r) => p.stdout!.once('data', r));
    return p.pid!;
  };
  const turn = (type: 'task_started' | 'task_complete') =>
    appendFileSync(rollout, `${JSON.stringify({ timestamp: new Date(Date.now() + 1_000).toISOString(), type: 'event_msg', payload: { type, turn_id: 't' } })}\n`);
  const codexSessions = async () => (await m.listSessions()).filter((s) => s.kind === 'codex');
  return { m, at, server, holds, turn, codexSessions, resume: { kind: 'codex' as const, cwd: at, resumeId: A } };
};

describe('LocalMachine', () => {
  describe('going on with a Codex conversation from the Mac', () => {
    it('starts a session of its own on it when it is open nowhere, joined to the thread', async () => {
      const s = await setup();
      const got = await s.m.createSession(s.resume);
      expect(got).toMatchObject({ kind: 'codex', codexThreadId: A, cwd: s.at });
      expect(await tmux.hasSession(`wod-${got.id}`)).toBe(true);
      await vi.waitFor(() => expect(s.server.calls).toContainEqual({ method: 'thread/resume', params: { threadId: A, excludeTurns: true } }));
    });

    it('gives the session already going on with it here, asked again or twice at once', async () => {
      const s = await setup();
      const [a, b] = await Promise.all([s.m.createSession(s.resume), s.m.createSession(s.resume)]);
      expect(b.id).toBe(a.id);
      expect((await s.m.createSession(s.resume)).id).toBe(a.id);
      expect(await s.codexSessions()).toHaveLength(1);
    });

    it('refuses while a Codex in a terminal has it, unless asked to take it over', async () => {
      const s = await setup();
      const pid = await s.holds();
      await expect(s.m.createSession(s.resume)).rejects.toMatchObject({ status: 409, code: 'open-on-mac' });
      expect(alive(pid)).toBe(true);
      expect(await s.codexSessions()).toEqual([]);
    });

    it('takes it over from a Codex in a terminal: quits it there, then goes on with it here', async () => {
      const s = await setup();
      const pid = await s.holds();
      const got = await s.m.createSession({ ...s.resume, takeOver: true });
      expect(alive(pid)).toBe(false);
      expect(got).toMatchObject({ codexThreadId: A });
    });

    it.each<[string, { args?: string[]; env?: Record<string, string> }]>([
      ["an editor's or the Codex app's app server", { args: ['app-server'] }],
      ['a Codex in a WorkOffDesk session', { env: { WORKOFFDESK_SESSION: 'abcd1234' } }],
    ])('never takes it from %s, even when asked to', async (_, how) => {
      const s = await setup();
      const pid = await s.holds(how);
      await expect(s.m.createSession({ ...s.resume, takeOver: true })).rejects.toMatchObject({ status: 409, code: 'open-elsewhere' });
      expect(alive(pid)).toBe(true);
      expect(await s.codexSessions()).toEqual([]);
    });

    it('does not go on with it when the Codex in the terminal will not quit, and leaves that one running', { timeout: 20_000 }, async () => {
      const s = await setup();
      const pid = await s.holds({ ignoresTerm: true });
      await expect(s.m.createSession({ ...s.resume, takeOver: true })).rejects.toMatchObject({ status: 409, code: 'mac-would-not-quit' });
      expect(alive(pid)).toBe(true);
      expect(await s.codexSessions()).toEqual([]);
    });

    it.each<[string, (s: Awaited<ReturnType<typeof setup>>) => object]>([
      ['a folder that is not there', (s) => ({ ...s.resume, cwd: join(s.at, 'gone') })],
      ['a thread id that is not one', (s) => ({ ...s.resume, resumeId: 'abc' })],
    ])('refuses %s', async (_, spec) => {
      const s = await setup();
      await expect(s.m.createSession(spec(s) as typeof s.resume)).rejects.toMatchObject({ status: 400 });
    });

    it('says Codex is not set up on a Mac without it', async () => {
      const s = await setup({ codex: false });
      await expect(s.m.createSession(s.resume)).rejects.toMatchObject({ status: 400, message: 'Codex is not set up on this Mac' });
    });
  });

  describe('taking it over once its terminal is idle', () => {
    it('takes it over at once when the Codex there is idle', async () => {
      const s = await setup();
      const pid = await s.holds();
      expect(await s.m.takeOverWhenIdle(s.resume)).toMatchObject({ codexThreadId: A });
      expect(alive(pid)).toBe(false);
    });

    it('waits while the Codex there runs a turn, then takes it over', { timeout: 20_000 }, async () => {
      const s = await setup();
      const pid = await s.holds();
      s.turn('task_started');
      expect(await s.m.takeOverWhenIdle(s.resume)).toBeNull();
      expect(s.m.takingOver(A)).toBe(true);
      expect(await s.m.takeOverWhenIdle(s.resume)).toBeNull();
      await new Promise((r) => setTimeout(r, 2_500));
      expect(alive(pid)).toBe(true);
      s.turn('task_complete');
      await vi.waitFor(async () => expect(await s.codexSessions()).toHaveLength(1), { timeout: 8_000, interval: 200 });
      expect(alive(pid)).toBe(false);
      // Taking over lasts until the session here has joined the thread, a moment after it is listed.
      await vi.waitFor(() => expect(s.m.takingOver(A)).toBe(false));
    });

    it('stops waiting when the wait is called off, and takes nothing over', { timeout: 20_000 }, async () => {
      const s = await setup();
      const pid = await s.holds();
      s.turn('task_started');
      expect(await s.m.takeOverWhenIdle(s.resume)).toBeNull();
      expect(await s.m.takeOverWhenIdle(s.resume)).toBeNull();
      expect(s.m.cancelTakeOver(A)).toBe(true);
      expect(s.m.takingOver(A)).toBe(false);
      s.turn('task_complete');
      await new Promise((r) => setTimeout(r, 4_500));
      expect(alive(pid)).toBe(true);
      expect(await s.codexSessions()).toEqual([]);
      expect(s.m.cancelTakeOver(A)).toBe(false);
    });

    it('takes it over at once when asked to while waiting', async () => {
      const s = await setup();
      const pid = await s.holds();
      s.turn('task_started');
      expect(await s.m.takeOverWhenIdle(s.resume)).toBeNull();
      expect(await s.m.createSession({ ...s.resume, takeOver: true })).toMatchObject({ codexThreadId: A });
      expect(alive(pid)).toBe(false);
      expect(s.m.takingOver(A)).toBe(false);
    });
  });
});
