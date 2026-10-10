import { mkdtempSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAgent, type CodexHost } from '../../../../src/agents/codex/agent.js';
import { COMMAND_APPROVAL, FILE_APPROVAL } from '../../../../src/agents/codex/items.js';
import type { Journal } from '../../../../src/journal/index.js';
import { fakeCodexAppServer } from '../../../helpers/codexAppServer.js';
import { socketDir } from '../../../helpers/socketDir.js';
import { testTmux } from '../../../helpers/tmux.js';

// WorkOffDesk's sessions of Codex as one client of the app server, against a fake app server that tells it
// what a thread does; what the agent learns goes to a host that keeps it.
const dir = socketDir('ca');
// Never started: the app server answers on its socket in every test.
const { tmux } = testTmux(dir, 'ca');
afterAll(() => tmux.killServer());
const T = '0199aaaa-0000-7000-8000-00000000000a';
const OTHER = '0199aaaa-0000-7000-8000-00000000000b';

const closing: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of closing.splice(0).reverse()) await c();
});

type Session = { id: string; cwd: string; createdAt: number; threadId?: string };

const start = async (o: { answers?: Parameters<typeof fakeCodexAppServer>[2]; sessions?: Session[] } = {}) => {
  const at = mkdtempSync(join(dir, 'c-'));
  const server = await fakeCodexAppServer(join(at, 'sock'), [{ id: T, cwd: at, name: '', status: { type: 'idle' } }], o.answers);
  closing.push(() => server.close());
  const sessions: Session[] = o.sessions ?? [{ id: 's1', cwd: at, createdAt: 1 }];
  const seen = {
    moved: [] as [string, string, string][],
    named: [] as [string, string][],
    usage: new Map<string, unknown>(),
    asksChanged: [] as string[],
    items: [] as { session: string; id: string; item: unknown }[],
    live: [] as [string, string | null][],
  };
  const host: CodexHost = {
    journal: {
      putAgentItems: (session: string, _conv: string, entries: { id: string; item: unknown }[]) => seen.items.push(...entries.map((e) => ({ session, id: e.id, item: e.item }))),
      live: (session: string, text: string | null) => seen.live.push([session, text]),
    } as unknown as Journal,
    sessions: () => sessions,
    setThread: (id, threadId) => {
      const s = sessions.find((x) => x.id === id);
      if (s) s.threadId = threadId;
    },
    moved: (id, status, said) => seen.moved.push([id, status, said]),
    named: (id, name) => seen.named.push([id, name]),
    setUsage: (id, usage) => seen.usage.set(id, usage),
    asksChanged: (id) => seen.asksChanged.push(id),
    log: () => {},
  };
  const agent = new CodexAgent({ tmux, sock: join(at, 'sock'), codexBin: '/bin/false', shell: '/bin/sh' }, host);
  closing.push(() => agent.close());
  const called = (method: string) => server.calls.filter((c) => c.method === method);
  // The session's thread joined and what it held read.
  const joined = async (session = 's1') => {
    await agent.start(session, T);
    await vi.waitFor(() => expect(called('thread/items/list')).not.toEqual([]));
  };
  const push = (method: string, params: Record<string, unknown>, id?: number) => server.push({ ...(id !== undefined && { id }), method, params: { threadId: T, ...params } });
  const lastMoved = () => seen.moved.at(-1);
  // Everything pushed before it has been taken in once it is.
  let n = 0;
  const settled = async () => {
    const name = `settled ${++n}`;
    push('thread/name/updated', { threadName: name });
    await vi.waitFor(() => expect(seen.named.at(-1)?.[1]).toBe(name));
  };
  return { at, server, agent, seen, sessions, called, joined, push, lastMoved, settled };
};

describe('CodexAgent', () => {
  describe("joining a session's thread", () => {
    it('takes what the thread holds into the chat, a page at a time, and says its status, name and model', async () => {
      let page = 0;
      const s = await start({
        answers: {
          'thread/resume': () => ({ model: 'gpt-5-codex', reasoningEffort: 'high', thread: { id: T, name: 'Fix the login', status: { type: 'idle' } } }),
          'thread/items/list': () =>
            ++page === 1
              ? { data: [{ item: { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: 'fix it' }] }, startedAtMs: 0 }], nextCursor: 'p2' }
              : { data: [{ item: { id: 'a1', type: 'agentMessage', text: 'Fixed.' } }, { item: { id: 'r1', type: 'reasoning' } }] },
        },
      });
      await s.joined();
      expect(s.sessions[0].threadId).toBe(T);
      await vi.waitFor(() => expect(s.seen.items.map((i) => i.id)).toEqual(['u1', 'a1']));
      expect(s.called('thread/resume')).toEqual([{ method: 'thread/resume', params: { threadId: T, excludeTurns: true } }]);
      expect(s.called('thread/items/list').map((c) => c.params.cursor)).toEqual([undefined, 'p2']);
      expect(s.seen.items[0].item).toEqual({ k: 'user', text: 'fix it', at: '1970-01-01T00:00:00.000Z' });
      expect(s.seen.moved).toContainEqual(['s1', 'idle', '']);
      expect(s.seen.named).toEqual([['s1', 'Fix the login']]);
      expect(s.seen.usage.get('s1')).toEqual({ model: 'gpt-5-codex', effort: 'high' });
      expect(s.agent.lastReply('s1')).toBe('Fixed.');
    });

    it('joins one not written yet once its first turn starts', async () => {
      let resumes = 0;
      const s = await start({
        answers: {
          'thread/resume': () => {
            if (++resumes === 1) throw new Error('no rollout found for thread id');
            return { thread: { id: T, status: { type: 'active', activeFlags: [] } } };
          },
          'thread/read': () => ({ thread: { id: T, model: 'gpt-5-codex', status: { type: 'idle' } } }),
        },
      });
      await s.agent.start('s1', T);
      await vi.waitFor(() => expect(s.seen.usage.get('s1')).toEqual({ model: 'gpt-5-codex' }));
      expect(s.called('thread/items/list')).toEqual([]);
      s.push('thread/status/changed', { status: { type: 'active', activeFlags: [] } });
      await vi.waitFor(() => expect(s.called('thread/items/list')).not.toEqual([]));
      expect(resumes).toBe(2);
    });
  });

  describe("what a thread does, as its session's status", () => {
    it.each([
      ['running a turn', { type: 'active', activeFlags: [] }, 'working'],
      ['waiting on the person', { type: 'active', activeFlags: ['waitingOnApproval'] }, 'waiting'],
      ['idle', { type: 'idle' }, 'idle'],
      ['stopped by an error', { type: 'systemError' }, 'idle'],
    ])("sets the session's status for a thread %s", async (_, status, said) => {
      const s = await start();
      await s.joined();
      s.push('thread/status/changed', { status: { type: 'active', activeFlags: said === 'working' ? ['waitingOnApproval'] : [] } });
      await vi.waitFor(() => expect(s.lastMoved()?.[1]).not.toBe('idle'));
      s.push('thread/status/changed', { status });
      await vi.waitFor(() => expect(s.lastMoved()?.[1]).toBe(said));
    });

    it('is not changed by a status it does not know, or a thread no session holds', async () => {
      const s = await start();
      await s.joined();
      const before = s.seen.moved.length;
      s.push('thread/status/changed', { status: { type: 'notLoaded' } });
      s.push('thread/status/changed', { threadId: OTHER, status: { type: 'active', activeFlags: [] } });
      s.push('thread/status/changed', { status: { type: 'active', activeFlags: [] } });
      await vi.waitFor(() => expect(s.seen.moved.length).toBe(before + 1));
      expect(s.lastMoved()).toEqual(['s1', 'working', '']);
    });

    it('is compacting while the conversation is compacted, then what it was', async () => {
      const s = await start();
      await s.joined();
      s.push('thread/status/changed', { status: { type: 'active', activeFlags: [] } });
      s.push('item/started', { item: { id: 'k1', type: 'contextCompaction' } });
      await vi.waitFor(() => expect(s.lastMoved()?.[1]).toBe('compacting'));
      s.push('item/completed', { item: { id: 'k1', type: 'contextCompaction' } });
      await vi.waitFor(() => expect(s.lastMoved()?.[1]).toBe('working'));
      expect(s.seen.items.map((i) => i.item)).toContainEqual({ k: 'note', event: { e: 'compacted' } });
    });
  });

  describe('the chat as Codex writes it', () => {
    it('has each item once it is done, when it was done, and what Codex said last', async () => {
      const s = await start();
      await s.joined();
      s.push('item/completed', { item: { id: 'a2', type: 'agentMessage', text: 'All green.' }, completedAtMs: Date.parse('2026-10-08T10:00:00Z') });
      await vi.waitFor(() => expect(s.seen.items).toContainEqual({ session: 's1', id: 'a2', item: { k: 'text', text: 'All green.', at: '2026-10-08T10:00:00.000Z' } }));
      expect(s.agent.lastReply('s1')).toBe('All green.');
    });

    it('shows the reply being written as it comes, and nothing of it once it is done', async () => {
      const s = await start();
      await s.joined();
      s.push('item/agentMessage/delta', { itemId: 'a3', delta: 'Hel' });
      s.push('item/agentMessage/delta', { itemId: 'a3', delta: 'lo' });
      await vi.waitFor(() => expect(s.seen.live).toContainEqual(['s1', 'Hello']));
      expect(s.seen.live.filter(([, text]) => text)).toEqual([['s1', 'Hello']]);
      s.push('item/completed', { item: { id: 'a3', type: 'agentMessage', text: 'Hello' } });
      await vi.waitFor(() => expect(s.seen.live.at(-1)).toEqual(['s1', null]));
    });

    it('says a turn that was stopped was', async () => {
      const s = await start();
      await s.joined();
      s.push('turn/completed', { turn: { id: 't9', status: 'interrupted' } });
      await vi.waitFor(() => expect(s.seen.items).toContainEqual({ session: 's1', id: 't9#end', item: { k: 'note', event: { e: 'interrupted' } } }));
    });
  });

  describe('an approval Codex asks for', () => {
    const askToRun = (s: Awaited<ReturnType<typeof start>>, id = 42) => s.push(COMMAND_APPROVAL, { itemId: 'c1', command: 'npm test', reason: 'Run the tests' }, id);

    it("is held for the phone as a card, and the session says what it waits on", async () => {
      const s = await start();
      await s.joined();
      s.push('thread/status/changed', { status: { type: 'active', activeFlags: ['waitingOnApproval'] } });
      await vi.waitFor(() => expect(s.lastMoved()?.[1]).toBe('waiting'));
      askToRun(s);
      await vi.waitFor(() => expect(s.agent.asks('s1')).toHaveLength(1));
      expect(s.agent.asks('s1')[0]).toMatchObject({ id: 'codex-42', tool: 'Bash', title: 'npm test' });
      expect(s.seen.asksChanged).toContain('s1');
      expect(s.lastMoved()).toEqual(['s1', 'waiting', 'npm test']);
    });

    it.each([
      ['Yes', { allow: true as const }, 'accept'],
      ['No, which stops the turn', { allow: false as const }, 'cancel'],
    ])('is answered as the phone answers it: %s', async (_, answer, decision) => {
      const s = await start();
      await s.joined();
      askToRun(s);
      await vi.waitFor(() => expect(s.agent.asks('s1')).toHaveLength(1));
      expect(s.agent.answer('s1', 'codex-42', answer)).toBe(true);
      await vi.waitFor(() => expect(s.server.answered).toEqual([{ id: 42, result: { decision } }]));
      expect(s.agent.asks('s1')).toEqual([]);
      expect(s.agent.answer('s1', 'codex-42', answer)).toBe(false);
    });

    it('names the files of a change by the change as it started', async () => {
      const s = await start();
      await s.joined();
      s.push('item/started', { item: { id: 'f1', type: 'fileChange', changes: [{ path: '/work/a.ts', diff: '+x' }] } });
      s.push(FILE_APPROVAL, { itemId: 'f1', reason: 'Fix it' }, 43);
      await vi.waitFor(() => expect(s.agent.asks('s1')).toHaveLength(1));
      expect(s.agent.asks('s1')[0]).toMatchObject({ id: 'codex-43', tool: 'Edit', title: '/work/a.ts' });
    });

    it("is left to the terminal when it is not an approval, or is for a thread no session holds", async () => {
      const s = await start();
      await s.joined();
      s.push('item/tool/requestUserInput', { itemId: 'q1', questions: [] }, 44);
      s.push(COMMAND_APPROVAL, { threadId: OTHER, command: 'rm -rf build' }, 45);
      askToRun(s, 46);
      await vi.waitFor(() => expect(s.agent.asks('s1').map((a) => a.id)).toEqual(['codex-46']));
    });

    it.each<[string, (s: Awaited<ReturnType<typeof start>>) => void]>([
      ['the terminal answered it first', (s) => s.push('serverRequest/resolved', { requestId: 42 })],
      ['the turn ended', (s) => s.push('turn/completed', { turn: { id: 't1', status: 'completed' } })],
      ['the app server went away', (s) => s.server.drop()],
    ])('is let go of when %s', async (_, end) => {
      const s = await start();
      await s.joined();
      askToRun(s);
      await vi.waitFor(() => expect(s.agent.asks('s1')).toHaveLength(1));
      const changes = s.seen.asksChanged.length;
      end(s);
      await vi.waitFor(() => expect(s.agent.asks('s1')).toEqual([]));
      expect(s.seen.asksChanged.length).toBe(changes + 1);
      expect(s.agent.answer('s1', 'codex-42', { allow: true })).toBe(false);
    });

    it('is not let go of for another request the terminal answered', async () => {
      const s = await start();
      await s.joined();
      askToRun(s);
      await vi.waitFor(() => expect(s.agent.asks('s1')).toHaveLength(1));
      s.push('serverRequest/resolved', { requestId: 99 });
      await s.settled();
      expect(s.agent.asks('s1')).toHaveLength(1);
    });
  });

  describe('when the app server goes away', () => {
    it('connects again on the next listing, and joins every thread again', async () => {
      const s = await start();
      await s.joined();
      s.server.drop();
      await vi.waitFor(async () => {
        s.agent.follow('s1', T);
        expect(s.called('thread/resume')).toHaveLength(2);
      });
    });
  });

  describe("a thread a session's terminal started", () => {
    const started = (s: Awaited<ReturnType<typeof start>>, thread: Record<string, unknown>) => s.server.push({ method: 'thread/started', params: { thread: { id: OTHER, model: 'gpt-5-codex', ...thread } } });

    it('is the oldest session in its folder that has none yet, by the folder it really is', async () => {
      const at = mkdtempSync(join(dir, 'f-'));
      const elsewhere = mkdtempSync(join(dir, 'e-'));
      const link = join(dir, `link-${Date.now()}`);
      symlinkSync(at, link);
      const s = await start({
        sessions: [
          { id: 's1', cwd: at, createdAt: 0, threadId: T },
          { id: 'newer', cwd: at, createdAt: 3 },
          { id: 'older', cwd: link, createdAt: 2 },
          { id: 'away', cwd: elsewhere, createdAt: 1 },
        ],
      });
      await s.joined();
      started(s, { cwd: at });
      await vi.waitFor(() => expect(s.sessions.find((x) => x.id === 'older')?.threadId).toBe(OTHER));
      expect(s.sessions.find((x) => x.id === 'newer')?.threadId).toBeUndefined();
      expect(s.seen.moved).toContainEqual(['older', 'idle', '']);
      expect(s.seen.usage.get('older')).toEqual({ model: 'gpt-5-codex' });
    });

    it.each([
      ['one of no use to anyone after (ephemeral)', { ephemeral: true }],
      ["a subagent's", { parentThreadId: T }],
      ['one in a folder no session without a thread is in', { cwd: '/nowhere' }],
    ])('is no session\'s when it is %s', async (_, thread) => {
      const at = mkdtempSync(join(dir, 'f-'));
      const s = await start({ sessions: [{ id: 's1', cwd: at, createdAt: 0, threadId: T }, { id: 'new', cwd: at, createdAt: 1 }] });
      await s.joined();
      started(s, { cwd: at, ...thread });
      s.push('thread/status/changed', { status: { type: 'active', activeFlags: [] } });
      await vi.waitFor(() => expect(s.lastMoved()).toEqual(['s1', 'working', '']));
      expect(s.sessions.find((x) => x.id === 'new')?.threadId).toBeUndefined();
    });

    it('is found on connecting when it started while this server was not listening', async () => {
      const at = mkdtempSync(join(dir, 'f-'));
      const s = await start({
        sessions: [{ id: 'quiet', cwd: at, createdAt: 1 }],
        answers: {
          'thread/loaded/list': () => ({ data: [OTHER] }),
          'thread/read': (p) => ({ thread: { id: p.threadId, cwd: at } }),
        },
      });
      await s.agent.start('quiet');
      await vi.waitFor(() => expect(s.sessions[0].threadId).toBe(OTHER));
    });
  });

  describe('a message for Codex', () => {
    it('goes to the thread under the id it was sent with', async () => {
      const s = await start();
      await s.joined();
      await s.agent.send('s1', 'run the tests', 'q1');
      expect(s.called('turn/start')).toEqual([{ method: 'turn/start', params: { threadId: T, clientUserMessageId: 'q1', input: [{ type: 'text', text: 'run the tests', text_elements: [] }] } }]);
    });

    it('is refused for a session with no thread yet', async () => {
      const s = await start();
      await expect(s.agent.send('nobody', 'hi', 'q1')).rejects.toThrow('this Codex session has no thread yet');
    });
  });

  describe('what the usage pill shows of a session', () => {
    it("is the plan's limits for every session, the context of each, and the model it was moved to", async () => {
      const s = await start();
      await s.joined();
      s.push('thread/tokenUsage/updated', { tokenUsage: { modelContextWindow: 1000, last: { totalTokens: 250 } } });
      s.push('thread/settings/updated', { threadSettings: { model: 'gpt-5.1-codex', effort: 'low' } });
      s.server.push({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 30 } } } });
      await vi.waitFor(() => expect(s.seen.usage.get('s1')).toEqual({ model: 'gpt-5.1-codex', effort: 'low', context: 25, fiveHour: { used: 30 } }));
    });
  });

  describe("a thread's name", () => {
    it('is told when Codex or the person names it, and not when the name is blank', async () => {
      const s = await start();
      await s.joined();
      s.push('thread/name/updated', { threadName: '   ' });
      s.push('thread/name/updated', { threadName: 'Round the buttons' });
      await vi.waitFor(() => expect(s.seen.named).toEqual([['s1', 'Round the buttons']]));
    });
  });
});
