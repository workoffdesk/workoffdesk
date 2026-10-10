import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexAgent } from '../../../../src/agents/codex/agent.js';
import { CodexThreads } from '../../../../src/agents/codex/threads.js';

// Every lock is in a codex home of the test's own, so lsof finds no process but the ones a test starts.
const A = '0199aaaa-0000-7000-8000-000000000001';
const B = '0199aaaa-0000-7000-8000-000000000002';
const C = '0199aaaa-0000-7000-8000-000000000003';

const started: ChildProcess[] = [];
afterEach(() => {
  for (const p of started.splice(0)) {
    try {
      process.kill(-p.pid!, 'SIGKILL');
    } catch {
      // gone already
    }
  }
});

const T0 = Date.now();
type Raw = Record<string, unknown>;
const thread = (id: string, o: Raw = {}): Raw => ({ id, cwd: '/Users/someone/app', name: '', preview: 'the first words', source: 'cli', updatedAt: T0 / 1000 - 600, path: null, ...o });

const setup = (listed: Raw[] = [], o: { all?: Raw[] } = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'ts-codex-'));
  mkdirSync(join(home, 'thread-writer-locks'));
  const sock = join(home, 'codex.sock');
  const calls = { list: 0, read: [] as string[] };
  const agent = {
    listThreads: vi.fn(async () => {
      calls.list++;
      return listed;
    }),
    readThread: async (id: string) => {
      calls.read.push(id);
      return [...listed, ...(o.all ?? [])].find((t) => t.id === id);
    },
  };
  const threads = new CodexThreads({ agent: agent as unknown as CodexAgent, sock, codexHome: home });
  // A process that holds the thread's lock, started with `args` after it and `env` as all its environment.
  const holds = async (id: string, args: string[], env: Record<string, string> = {}) => {
    const lock = join(home, 'thread-writer-locks', `${id}.lock`);
    writeFileSync(lock, '');
    const fd = openSync(lock, 'r');
    // Node, as Codex is: ps shows no environment of the system's own programs, such as /bin/sh.
    const p = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', ...args], { stdio: ['ignore', 'ignore', 'ignore', fd], env: { PATH: '/bin:/usr/bin', ...env }, detached: true });
    closeSync(fd);
    started.push(p);
    await new Promise((r) => p.once('spawn', r));
    return p.pid!;
  };
  const rollout = (...lines: object[]) => {
    const f = join(home, `rollout-${Math.random()}.jsonl`);
    writeFileSync(f, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
    return f;
  };
  return { home, sock, threads, agent, calls, holds, rollout };
};
const turnStarted = (ms: number) => ({ timestamp: new Date(ms).toISOString(), type: 'event_msg', payload: { type: 'task_started', turn_id: 't' } });

describe('CodexThreads', () => {
  describe('list', () => {
    it('lists the ones people opened in the terminal or an editor, newest first, by name or else first words', async () => {
      const { threads } = setup([
        thread(A, { name: '  Fix login ', updatedAt: 100 }),
        thread(B, { preview: 'add\n  the  tests', source: 'vscode', updatedAt: 300 }),
        thread(C, { source: 'exec', updatedAt: 400 }),
        thread('sub', { parentThreadId: A, updatedAt: 400 }),
        thread('eph', { ephemeral: true, updatedAt: 400 }),
        thread('', { updatedAt: 400 }),
        'not a thread',
      ] as Raw[]);
      expect(await threads.list()).toEqual([
        { id: B, cwd: '/Users/someone/app', title: 'add the tests', path: null, updatedAt: 300_000, holder: null, busy: false, lastPrompt: null, lastActivity: 300_000 },
        expect.objectContaining({ id: A, title: 'Fix login', updatedAt: 100_000 }),
      ]);
    });

    it('orders them by when their rollout was written last, when that is later', async () => {
      const s = setup();
      const old = s.rollout({ type: 'session_meta' });
      utimesSync(old, 500, 500);
      const listed = [thread(A, { updatedAt: 100, path: old }), thread(B, { updatedAt: 200 })];
      const t = new CodexThreads({ agent: { listThreads: async () => listed, readThread: async () => undefined } as unknown as CodexAgent, sock: s.sock, codexHome: s.home });
      expect((await t.list()).map((x) => [x.id, x.lastActivity])).toEqual([
        [A, 500_000],
        [B, 200_000],
      ]);
    });

    it('says what the person said last in each', async () => {
      const s = setup();
      const path = s.rollout({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'and the docs' }] } } });
      const t = new CodexThreads({ agent: { listThreads: async () => [thread(A, { path })], readThread: async () => undefined } as unknown as CodexAgent, sock: s.sock, codexHome: s.home });
      expect((await t.list())[0].lastPrompt).toBe('and the docs');
    });

    it('shows them held by no one when no Codex has a lock, or there is no lock folder at all', async () => {
      const s = setup([thread(A)]);
      expect((await s.threads.list())[0].holder).toBeNull();
      const none = new CodexThreads({ agent: s.agent as unknown as CodexAgent, sock: s.sock, codexHome: join(s.home, 'nowhere') });
      expect((await none.list())[0].holder).toBeNull();
    });

    describe('where a conversation is open', () => {
      it('is a terminal, for a Codex someone started there, with its process and when it started', async () => {
        const s = setup([thread(A)]);
        const before = Math.floor(Date.now() / 1000) * 1000;
        const pid = await s.holds(A, ['resume', A]);
        const [t] = await s.threads.list();
        expect(t.holder).toEqual({ at: 'terminal', pid, tty: null, since: expect.any(Number) });
        const since = (t.holder as { since: number }).since;
        expect(since).toBeGreaterThanOrEqual(before);
        expect(since).toBeLessThanOrEqual(Date.now());
      });

      it('is elsewhere for a Codex a WorkOffDesk session started, as its environment says', async () => {
        const s = setup([thread(A)]);
        await s.holds(A, ['resume', A], { WORKOFFDESK_SESSION: 'abcd1234' });
        expect((await s.threads.list())[0].holder).toEqual({ at: 'elsewhere' });
      });

      it("is here for this server's app server, its socket made after the server started and named through a link", async () => {
        const s = setup([thread(A)]);
        writeFileSync(s.sock, '');
        const named = realpathSync(s.sock) === s.sock ? s.sock.replace(/^\/private\//, '/') : realpathSync(s.sock);
        await s.holds(A, ['app-server', '--listen', `unix://${named}`]);
        expect((await s.threads.list())[0].holder).toEqual({ at: 'here' });
      });

      it('is found for one opened since the list was made, unless it is not one people opened', async () => {
        const s = setup([thread(A)], { all: [thread(B, { updatedAt: T0 / 1000 }), thread(C, { source: 'exec' })] });
        await s.threads.list();
        await s.holds(B, ['resume', B]);
        await s.holds(C, ['resume', C]);
        const got = await s.threads.list();
        expect(got.map((t) => t.id)).toEqual([B, A]);
        expect(got[0].holder).toMatchObject({ at: 'terminal' });
        expect(s.calls.list).toBe(1);
      });
    });

    describe('a conversation at work', () => {
      it('is one whose Codex in a terminal started a turn it has not ended', async () => {
        const s = setup();
        const pid = await s.holds(A, ['resume', A]);
        const path = s.rollout(turnStarted(Date.now() + 1_000));
        const t = new CodexThreads({ agent: { listThreads: async () => [thread(A, { path })], readThread: async () => undefined } as unknown as CodexAgent, sock: s.sock, codexHome: s.home });
        expect((await t.list())[0]).toMatchObject({ holder: { at: 'terminal', pid }, busy: true });
      });

      it('is not one whose turn was left unended by a Codex quit before the one holding it now started', async () => {
        const s = setup();
        await s.holds(A, ['resume', A]);
        const path = s.rollout(turnStarted(Date.now() - 3_600_000));
        const t = new CodexThreads({ agent: { listThreads: async () => [thread(A, { path })], readThread: async () => undefined } as unknown as CodexAgent, sock: s.sock, codexHome: s.home });
        expect((await t.list())[0]).toMatchObject({ holder: { at: 'terminal' }, busy: false });
      });

      it.each([
        ['open nowhere', null],
        ['open in another app', ['app-server']],
      ])('is not one %s, whatever its rollout says', async (_, args) => {
        const s = setup();
        if (args) await s.holds(A, args);
        const path = s.rollout(turnStarted(Date.now() + 1_000));
        const t = new CodexThreads({ agent: { listThreads: async () => [thread(A, { path })], readThread: async () => undefined } as unknown as CodexAgent, sock: s.sock, codexHome: s.home });
        expect((await t.list())[0].busy).toBe(false);
      });

      it('is not one whose rollout is gone', async () => {
        const s = setup([thread(A, { path: '/nowhere/rollout.jsonl' })]);
        await s.holds(A, ['resume', A]);
        expect((await s.threads.list())[0]).toMatchObject({ busy: false, lastPrompt: null });
      });
    });

    describe('with the list kept', () => {
      afterEach(() => vi.useRealTimers());

      it('makes the list once for everyone who asks while it is being made', async () => {
        const s = setup([thread(A)]);
        const [a, b] = [s.threads.list(), s.threads.list()];
        expect(a).toBe(b);
        await a;
        expect(s.calls.list).toBe(1);
      });

      it('keeps the list for five minutes, then makes it again while the kept one answers', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const s = setup([thread(A)]);
        await s.threads.list();
        vi.advanceTimersByTime(4 * 60_000);
        await s.threads.list();
        expect(s.calls.list).toBe(1);
        vi.advanceTimersByTime(2 * 60_000);
        s.agent.listThreads.mockImplementationOnce(async () => {
          s.calls.list++;
          return [thread(A), thread(B)];
        });
        expect((await s.threads.list()).map((t) => t.id)).toEqual([A]);
        await vi.waitFor(async () => expect((await s.threads.list()).map((t) => t.id)).toEqual([A, B]));
        expect(s.calls.list).toBe(2);
      });

      it('fails when Codex cannot list them and none were kept, and goes on with the kept ones when it cannot later', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const s = setup([thread(A)]);
        s.agent.listThreads.mockRejectedValueOnce(new Error('app server gone'));
        await expect(s.threads.list()).rejects.toThrow('app server gone');
        expect((await s.threads.list()).map((t) => t.id)).toEqual([A]);
        vi.advanceTimersByTime(6 * 60_000);
        s.agent.listThreads.mockRejectedValueOnce(new Error('app server gone'));
        expect((await s.threads.list()).map((t) => t.id)).toEqual([A]);
      });
    });
  });

  describe('where', () => {
    it('gives the one the list has', async () => {
      const s = setup([thread(A)]);
      expect(await s.threads.where(A)).toMatchObject({ id: A, holder: null });
      expect(s.calls.read).toEqual([]);
    });

    it('reads it on its own, with where it is open, when the list does not have it, whatever started it', async () => {
      const s = setup([thread(A)], { all: [thread(B, { source: 'exec' })] });
      const pid = await s.holds(B, ['resume', B]);
      expect(await s.threads.where(B)).toMatchObject({ id: B, holder: { at: 'terminal', pid } });
    });

    it('gives none when Codex has no such thread', async () => {
      expect(await setup([thread(A)]).threads.where(B)).toBeNull();
    });
  });
});
