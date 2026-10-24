import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatItem } from '../../../src/agents/claude/transcript/chat.js';
import { Journal, type MessageRow, type MessageState, type Row } from '../../../src/journal/index.js';
import type { Titles } from '../../../src/journal/ingest.js';

// Everything a session's page shows, as rows a copy on the phone catches up on by version, and what is taken
// into it from Claude's transcript.
const dir = mkdtempSync(join(tmpdir(), 'ts-journal-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const S = 'session-1';
const CONV = '0199bbbb-0000-7000-8000-000000000001';
const CONV2 = '0199bbbb-0000-7000-8000-000000000002';
const CONV3 = '0199bbbb-0000-7000-8000-000000000003';
const T0 = Date.parse('2026-10-08T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const closing: (() => void)[] = [];
afterEach(() => {
  for (const c of closing.splice(0)) c();
  vi.useRealTimers();
});

let n = 0;
const open = (o: { file?: string; root?: string } = {}) => {
  const logged: [string, object][] = [];
  const titled: [string, Titles, boolean][] = [];
  const file = o.file ?? join(dir, `${++n}.db`);
  const j = new Journal({ file, root: o.root, log: (msg, x) => void logged.push([msg, x]), titled: (id, found, fresh) => titled.push([id, found, fresh]) });
  closing.push(() => j.close());
  return { j, file, logged, titled };
};

const all = (j: Journal, id = S) => j.sync(id, undefined, 0).rows;
const stateOf = (j: Journal, name: string, id = S) => all(j, id).find((r) => r.t === 'state' && r.key === name)?.body;
const itemsOf = (j: Journal, id = S) => all(j, id).filter((r) => r.t === 'item').map((r) => r.body as ChatItem & { pos: number; conv: string });
const messagesOf = (j: Journal, id = S) => Object.fromEntries(j.messages(id).map((m) => [m.text, m.state]));
const head = (j: Journal, id = S) => j.heads()[id] ?? 0;
const message = (id: string, text: string, state: MessageState, sentAt = T0): MessageRow => ({ id, text, sentAt, state, ord: null, item: null });
const texts = (count: number, from = 0) => Array.from({ length: count }, (_, i) => ({ id: `a${from + i}`, item: { k: 'text' as const, text: `reply ${from + i}` } }));
const screen = (live: string | null) => ({ choices: null, panel: null, suggestion: null, mode: null, live });

// A transcript of Claude Code's, as it writes one: a JSON record a line, in a folder per project.
const transcript = (conv = CONV, root = mkdtempSync(join(dir, 'root-'))) => {
  mkdirSync(join(root, '-work-proj'), { recursive: true });
  const path = join(root, '-work-proj', `${conv}.jsonl`);
  writeFileSync(path, '', { flag: 'a' });
  let u = 0;
  const add = (r: object, end = '\n') => appendFileSync(path, JSON.stringify({ uuid: `${conv.slice(-4)}-${++u}`, ...r }) + end);
  return {
    root,
    path,
    add,
    prompt: (text: string, at = T0 + 1000) => add({ type: 'user', timestamp: iso(at), message: { role: 'user', content: text } }),
    reply: (text: string) => add({ type: 'assistant', timestamp: iso(T0), message: { role: 'assistant', content: [{ type: 'text', text }] } }),
  };
};

describe('Journal', () => {
  describe('sync', () => {
    it('gives the rows written after the version it has, and none once it has them all', () => {
      const { j } = open();
      j.status(S, 'idle');
      j.putMessage(S, message('q1', 'fix it', 'queued'));
      const first = j.sync(S, j.epoch, 0);
      expect(first).toMatchObject({ reset: true, v: head(j) });
      expect(first.rows.map((r) => `${r.t}:${r.key}`).sort()).toEqual(['message:q1', 'state:status', 'state:workingSince']);
      expect(j.sync(S, j.epoch, first.v)).toEqual({ epoch: j.epoch, v: first.v, rows: [], more: false });
      j.asks(S, [{ id: 'a1', kind: 'permission', tool: 'Bash', title: 'npm test', detail: '', always: null }]);
      const next = j.sync(S, j.epoch, first.v);
      expect(next.rows.map((r) => `${r.t}:${r.key}`)).toEqual(['state:asks']);
      expect(next.v).toBe(first.v + 1);
    });

    it.each<[string, (j: Journal) => [string | undefined, number]]>([
      ['of another journal', (j) => ['another-epoch', head(j)]],
      ['of no journal', (j) => [undefined, head(j)]],
      ['with nothing yet', (j) => [j.epoch, 0]],
      ['ahead of the journal', (j) => [j.epoch, head(j) + 1]],
    ])('starts over when it is %s', (_, copy) => {
      const { j } = open();
      j.status(S, 'idle');
      const r = j.sync(S, ...copy(j));
      expect(r).toMatchObject({ epoch: j.epoch, reset: true, v: head(j), more: false });
      expect(r.rows).toHaveLength(2);
    });

    it.each([
      [500, false],
      [501, true],
    ])('given a copy %i rows behind, starts it over: %s', (behind, over) => {
      const { j } = open();
      j.status(S, 'idle');
      const from = head(j);
      for (let i = 0; i < behind; i++) j.putMessage(S, message(`q${i}`, `m${i}`, 'queued'));
      const r = j.sync(S, j.epoch, from);
      expect(r).toMatchObject({ v: head(j), more: false });
      expect(r.reset).toBe(over ? true : undefined);
    });

    it('starts over a copy more than a page behind: every message and state, and the newest items of the conversation', () => {
      const { j } = open();
      j.status(S, 'idle');
      const from = head(j);
      for (let i = 0; i < 400; i++) j.putMessage(S, message(`q${i}`, `m${i}`, 'queued'));
      j.putAgentItems(S, CONV, texts(500));
      for (let i = 0; i < 300; i++) j.onMac(S, i + 1);
      const r = j.sync(S, j.epoch, from);
      expect(r).toMatchObject({ epoch: j.epoch, v: head(j), more: false, reset: true, older: 400 });
      expect(r.rows.filter((x) => x.t === 'message')).toHaveLength(400);
      expect(r.rows.filter((x) => x.t === 'item').map((x) => (x.body as { pos: number }).pos)).toEqual(Array.from({ length: 100 }, (_, i) => 400 + i));
      expect(r.rows.filter((x) => x.t === 'state').map((x) => [x.key, x.body])).toEqual(
        expect.arrayContaining([['conv', { conv: CONV }], ['onMac', 300], ['status', 'idle']]),
      );
    });

    it('gives one starting over the newest items, and pages of older ones back to the first', () => {
      const { j } = open();
      j.putAgentItems(S, CONV, texts(250));
      const first = j.sync(S, undefined, 0);
      const pos = (rows: Row[]) => rows.filter((r) => r.t === 'item').map((r) => (r.body as { pos: number }).pos);
      expect(pos(first.rows)).toEqual(Array.from({ length: 100 }, (_, i) => 150 + i));
      expect(first.older).toBe(150);
      const older = j.older(S, CONV, 150);
      expect(pos(older.rows)).toEqual(Array.from({ length: 100 }, (_, i) => 50 + i));
      expect(older.older).toBe(50);
      expect(j.older(S, CONV, 50)).toMatchObject({ older: null });
      expect(pos(j.older(S, CONV, 50).rows)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    });
  });

  describe('when a session changes', () => {
    it('makes no change when it writes what is there already', () => {
      const { j } = open();
      const told: number[] = [];
      j.onHead(() => told.push(head(j)));
      j.screenAsIs(S, { choices: null, panel: null, suggestion: null, mode: 'plan' });
      j.screenAsIs(S, { choices: null, panel: null, suggestion: null, mode: 'plan' });
      j.onMac(S, 1);
      j.onMac(S, 1);
      j.asks(S, []);
      j.asks(S, []);
      expect(told).toEqual([1, 2, 3]);
    });

    it('writes an item once: the same item again neither moves nor changes it', () => {
      const { j } = open();
      j.putAgentItems(S, CONV, [{ id: 'a1', item: { k: 'text', text: 'first' } }]);
      const v = head(j);
      j.putAgentItems(S, CONV, [{ id: 'a1', item: { k: 'text', text: 'changed' } }, { id: 'a2', item: { k: 'text', text: 'second' } }]);
      expect(itemsOf(j).map((i) => [i.pos, i.k === 'text' && i.text])).toEqual([[0, 'first'], [1, 'second']]);
      expect(head(j)).toBe(v + 1);
    });

    it('tells who listens to the session each change from where the last ended, and one more than a page long as a start over', () => {
      const { j } = open();
      j.status(S, 'idle');
      const calls: { from: number; to: number; rows: number; reset?: true; older?: number | null }[] = [];
      const stop = j.onRows(S, (from, c) => calls.push({ from, to: c.v, rows: c.rows.length, reset: c.reset, older: c.older }));
      const other: number[] = [];
      j.onRows('session-2', (_from, c) => other.push(c.v));
      const start = head(j);
      j.putAgentItems(S, CONV, texts(400));
      j.onMac(S, 1);
      j.putAgentItems(S, CONV, texts(1200, 400));
      expect(calls).toEqual([
        { from: start, to: start + 401, rows: 401, reset: undefined, older: undefined },
        { from: start + 401, to: start + 402, rows: 1, reset: undefined, older: undefined },
        { from: start + 402, to: head(j), rows: 100 + 4, reset: true, older: 1500 },
      ]);
      expect(other).toEqual([]);
      stop();
      j.onMac(S, 2);
      expect(calls).toHaveLength(3);
    });

    it('tells one who comes after all others left from then on, not from when they left', () => {
      const { j } = open();
      j.onRows(S, () => {})();
      j.onMac(S, 1);
      j.onMac(S, 2);
      const told: [number, number][] = [];
      j.onRows(S, (from, c) => told.push([from, c.rows.length]));
      j.onMac(S, 3);
      expect(told).toEqual([[2, 1]]);
    });

    it('tells one while another still listens, from where they were told up to', () => {
      const { j } = open();
      const a: number[] = [];
      const b: number[] = [];
      const stopA = j.onRows(S, (from) => a.push(from));
      j.onMac(S, 1);
      j.onRows(S, (from) => b.push(from));
      stopA();
      j.onMac(S, 2);
      expect(a).toEqual([0]);
      expect(b).toEqual([1]);
    });
  });

  describe('drop', () => {
    it('leaves nothing of it, and tells who watches the heads', () => {
      const { j } = open();
      j.putAgentItems(S, CONV, texts(3));
      j.putMessage(S, message('q1', 'fix it', 'queued'));
      j.onMac('session-2', 1);
      const told: string[] = [];
      j.onHead(() => told.push('head'));
      j.drop(S);
      expect(j.heads()).toEqual({ 'session-2': 1 });
      expect(all(j)).toEqual([]);
      expect(j.messages(S)).toEqual([]);
      expect(told).toEqual(['head']);
    });
  });

  describe('on disk', () => {
    it('keeps the same journal when the server starts again: same epoch, the rows kept', () => {
      const { j, file } = open();
      j.putAgentItems(S, CONV, texts(2));
      const v = head(j);
      const epoch = j.epoch;
      j.close();
      closing.pop();
      const again = open({ file }).j;
      expect(again.epoch).toBe(epoch);
      expect(head(again)).toBe(v);
      expect(again.sync(S, epoch, v).rows).toEqual([]);
    });

    it("holds no ask and no paste half done once the server starts again: those were the last server's", () => {
      const { j, file } = open();
      j.asks(S, [{ id: 'a1', kind: 'permission', tool: 'Bash', title: 'npm test', detail: '', always: null }]);
      j.putMessage(S, message('q1', 'pasting', 'delivering'));
      j.putMessage(S, message('q2', 'waiting', 'queued'));
      j.close();
      closing.pop();
      const again = open({ file }).j;
      expect(stateOf(again, 'asks')).toEqual([]);
      expect(messagesOf(again)).toEqual({ pasting: 'delivered', waiting: 'queued' });
    });

    it("keeps the file its owner's only, with what SQLite writes beside it", () => {
      const { j, file } = open();
      j.onMac(S, 1);
      j.close();
      closing.pop();
      chmodSync(file, 0o644);
      open({ file }).j.onMac(S, 2);
      for (const f of [file, `${file}-wal`, `${file}-shm`]) expect(statSync(f).mode & 0o777).toBe(0o600);
    });

    it('sets aside a file that cannot be read as a database, and starts a journal over', () => {
      const file = join(dir, 'broken.db');
      writeFileSync(file, 'not a database at all\n'.repeat(500));
      writeFileSync(`${file}-wal`, 'nor this');
      const { j, logged } = open({ file });
      expect(j.heads()).toEqual({});
      const [msg, o] = logged[0] as [string, { aside: string }];
      expect(msg).toBe('journal unreadable, set aside and started over');
      expect(readFileSync(o.aside, 'utf8')).toBe('not a database at all\n'.repeat(500));
      j.onMac(S, 1);
      expect(head(j)).toBe(1);
      j.close();
      closing.pop();
      expect(open({ file }).j.heads()).toEqual({ [S]: 1 });
    });
  });

  describe('status', () => {
    it('says since when it works, from when it set out, until it stops', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      const { j } = open();
      j.status(S, 'working');
      vi.setSystemTime(T0 + 5000);
      const v = head(j);
      j.status(S, 'working');
      expect(head(j)).toBe(v);
      expect(stateOf(j, 'workingSince')).toBe(T0);
      j.status(S, 'waiting');
      expect(stateOf(j, 'workingSince')).toBe(null);
      j.status(S, 'working');
      expect(stateOf(j, 'workingSince')).toBe(T0 + 5000);
    });

    it('says since when it compacts, apart from the work it broke off', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      const { j } = open();
      j.status(S, 'working');
      vi.setSystemTime(T0 + 5000);
      j.status(S, 'compacting');
      expect(stateOf(j, 'workingSince')).toBe(T0 + 5000);
      vi.setSystemTime(T0 + 9000);
      j.status(S, 'compacting');
      expect(stateOf(j, 'workingSince')).toBe(T0 + 5000);
      j.status(S, 'working');
      expect(stateOf(j, 'workingSince')).toBe(T0 + 9000);
      j.status(S, 'compacting');
      j.status(S, 'idle');
      expect(stateOf(j, 'workingSince')).toBe(null);
    });
  });

  describe('putAgentItems', () => {
    it('puts them after what the conversation has, and starts the page again for a new conversation', () => {
      const { j } = open();
      j.putAgentItems(S, CONV, texts(2));
      j.putAgentItems(S, CONV, texts(1, 2));
      expect(stateOf(j, 'conv')).toEqual({ conv: CONV });
      expect(itemsOf(j).map((i) => [i.conv, i.pos])).toEqual([[CONV, 0], [CONV, 1], [CONV, 2]]);
      j.putAgentItems(S, CONV2, texts(1, 10));
      expect(stateOf(j, 'conv')).toEqual({ conv: CONV2 });
      expect(itemsOf(j).map((i) => [i.conv, i.pos])).toEqual([[CONV2, 0]]);
    });

    it.each<[MessageState, MessageState]>([
      ['delivering', 'landed'],
      ['delivered', 'landed'],
      ['enqueued', 'landed'],
      ['unconfirmed', 'landed'],
      ['queued', 'queued'],
      ['taken', 'taken'],
      ['landed', 'landed'],
    ])('lands the message a user message carries the id of when it was %s', (was, is) => {
      const { j } = open();
      j.putMessage(S, message('q1', 'fix it', was));
      j.putAgentItems(S, CONV, [{ id: 'u1', item: { k: 'user', text: 'fix it' }, clientId: 'q1' }]);
      expect(j.messages(S)[0]).toMatchObject({ state: is, item: is === was ? null : 'u1' });
    });
  });

  describe('with the reply being written', () => {
    it('shows it as the screen shows it, and keeps it while the screen does not, until the transcript has it', async () => {
      const t = transcript();
      const { j } = open({ root: t.root });
      t.prompt('explain it');
      await j.ingest(S, CONV);
      j.screen(S, screen('The login fails because'));
      expect(stateOf(j, 'live')).toEqual({ text: 'The login fails because' });
      j.screen(S, screen(null));
      expect(stateOf(j, 'live')).toEqual({ text: 'The login fails because' });
      t.reply('Checked the cookie.');
      await j.ingest(S, CONV);
      expect(stateOf(j, 'live')).toEqual({ text: null });
    });

    it('does not show it a second time when the transcript has it already', async () => {
      const t = transcript();
      const { j } = open({ root: t.root });
      t.prompt('explain it');
      t.reply('The login fails because the cookie expired.');
      await j.ingest(S, CONV);
      j.screen(S, screen('The login fails because the cookie'));
      expect(stateOf(j, 'live')).toEqual({ text: null });
    });

    it('shows it when it says again what Claude said before the last prompt', async () => {
      const t = transcript();
      const { j } = open({ root: t.root });
      t.prompt('explain it');
      t.reply('The login fails because the cookie expired.');
      t.prompt('say it again');
      await j.ingest(S, CONV);
      j.screen(S, screen('The login fails because the cookie'));
      expect(stateOf(j, 'live')).toEqual({ text: 'The login fails because the cookie' });
    });

    it('shows it as an agent says it, until it says it is written', () => {
      const { j } = open();
      j.live(S, 'Hello');
      expect(stateOf(j, 'live')).toEqual({ text: 'Hello' });
      j.live(S, null);
      expect(stateOf(j, 'live')).toEqual({ text: null });
    });
  });

  describe('ingest', () => {
    it('takes each whole line once, from where it stopped, and leaves one still being written', async () => {
      const t = transcript();
      const { j, titled } = open({ root: t.root });
      t.prompt('fix it');
      t.reply('Fixed.');
      await j.ingest(S, CONV);
      expect(stateOf(j, 'conv')).toEqual({ conv: CONV });
      expect(itemsOf(j).map((i) => [i.pos, i.k])).toEqual([[0, 'user'], [1, 'text']]);
      expect(titled).toEqual([[S, {}, true]]);
      t.add({ type: 'assistant', timestamp: iso(T0), message: { role: 'assistant', content: [{ type: 'text', text: 'Half' }] } }, '');
      await j.ingest(S, CONV);
      expect(itemsOf(j)).toHaveLength(2);
      appendFileSync(t.path, '\n');
      t.reply('And tested.');
      await j.ingest(S, CONV);
      expect(itemsOf(j).map((i) => i.k === 'text' && i.text)).toEqual([false, 'Fixed.', 'Half', 'And tested.']);
      expect(titled).toHaveLength(1);
    });

    it('takes a record written twice once, and what comes after it next to what came before', async () => {
      const t = transcript();
      const { j } = open({ root: t.root });
      const once = { uuid: 'same', type: 'user', timestamp: iso(T0), message: { role: 'user', content: 'fix it' } };
      t.add(once);
      t.add(once);
      t.reply('Fixed.');
      await j.ingest(S, CONV);
      expect(itemsOf(j).map((i) => [i.pos, i.k])).toEqual([[0, 'user'], [1, 'text']]);
    });

    it('leaves what it read to the next run when the session went on to another conversation meanwhile', async () => {
      const t = transcript();
      t.prompt('fix it');
      const { j } = open({ root: t.root });
      const run = j.ingest(S, CONV);
      while (stateOf(j, 'conv') === undefined) await new Promise((r) => setImmediate(r));
      j.putAgentItems(S, CONV2, texts(1));
      await run;
      expect(stateOf(j, 'conv')).toEqual({ conv: CONV2 });
      expect(itemsOf(j).map((i) => i.conv)).toEqual([CONV2]);
    });

    it('says the names the conversation was given, the latest of each, and not a blank one', async () => {
      const t = transcript();
      const { j, titled } = open({ root: t.root });
      t.add({ type: 'ai-title', aiTitle: 'Login' });
      t.add({ type: 'ai-title', aiTitle: 'Fix login' });
      t.add({ type: 'ai-title', aiTitle: '' });
      t.add({ type: 'custom-title', customTitle: 'Login' });
      t.add({ type: 'custom-title', customTitle: 'Login, round two' });
      t.add({ type: 'custom-title', customTitle: '  ' });
      await j.ingest(S, CONV);
      expect(titled).toEqual([[S, { ai: 'Fix login', custom: 'Login, round two' }, true]]);
      t.add({ type: 'ai-title', aiTitle: 'Fix the login cookie' });
      await j.ingest(S, CONV);
      expect(titled.at(-1)).toEqual([S, { ai: 'Fix the login cookie' }, false]);
    });

    it("works out Claude's task list from the conversation", async () => {
      const t = transcript();
      const { j } = open({ root: t.root });
      const todo = (todos: object[]) => t.add({ type: 'assistant', timestamp: iso(T0), message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${todos.length}`, name: 'TodoWrite', input: { todos } }] } });
      todo([{ content: 'Write tests', status: 'in_progress' }]);
      await j.ingest(S, CONV);
      expect(stateOf(j, 'tasks')).toEqual([{ subject: 'Write tests', status: 'in_progress' }]);
      todo([{ content: 'Write tests', status: 'completed' }, { content: 'Ship', status: 'pending' }]);
      await j.ingest(S, CONV);
      expect(stateOf(j, 'tasks')).toEqual([{ subject: 'Write tests', status: 'completed' }, { subject: 'Ship', status: 'pending' }]);
      expect(stateOf(j, 'background')).toEqual([]);
    });

    it('runs once at a time for a session; asked twice meanwhile, once more after, for the conversation asked last', async () => {
      const root = mkdtempSync(join(dir, 'root-'));
      for (const c of [CONV, CONV2, CONV3]) transcript(c, root).prompt(`in ${c.slice(-1)}`);
      const { j, titled } = open({ root });
      await Promise.all([j.ingest(S, CONV), j.ingest(S, CONV2), j.ingest(S, CONV3)]);
      expect(titled.map(([, , fresh]) => fresh)).toEqual([true, true]);
      expect(stateOf(j, 'conv')).toEqual({ conv: CONV3 });
      expect(itemsOf(j).map((i) => i.k === 'user' && i.text)).toEqual(['in 3']);
    });

    it.each([
      ['no conversation', null],
      ['a conversation not on this Mac', CONV2],
      ['a conversation id that is not one', '../../etc/passwd'],
    ])('does nothing for %s', async (_, conv) => {
      const t = transcript();
      const { j } = open({ root: t.root });
      await j.ingest(S, conv);
      expect(j.heads()).toEqual({});
    });

    it('says it could not read the transcript, and goes on', async () => {
      const t = transcript();
      t.prompt('fix it');
      chmodSync(t.path, 0o000);
      const { j, logged } = open({ root: t.root });
      await expect(j.ingest(S, CONV)).resolves.toBeUndefined();
      expect(logged.map(([m]) => m)).toContain('journal ingest failed');
      chmodSync(t.path, 0o600);
      await j.ingest(S, CONV);
      expect(itemsOf(j)).toHaveLength(1);
    });

    describe('with a message sent to Claude', () => {
      const sent = async (prompts: [string, number][], messages: MessageRow[]) => {
        const t = transcript();
        const o = open({ root: t.root });
        for (const m of messages) o.j.putMessage(S, m);
        for (const [text, at] of prompts) t.prompt(text, at);
        await o.j.ingest(S, CONV);
        return { ...o, t };
      };

      it('lands it at the prompt with its words, as Claude took it, whatever a paste left out of it', async () => {
        const { j } = await sent([['fix it', T0 + 1000]], [message('q1', ' fix\u0007 it\n', 'delivered')]);
        expect(j.messages(S)[0]).toMatchObject({ state: 'landed', item: `${CONV.slice(-4)}-1:0` });
      });

      it.each([
        ['a tab turned into four spaces', '.\tfix it', '.    fix it'],
        ['a tab turned into two spaces', 'fix\tit', 'fix  it'],
        ['Windows line breaks made plain', 'fix it\r\nand the tests', 'fix it\nand the tests'],
        ['spaces kept where the prompt has a tab', 'fix    it', 'fix\tit'],
      ])('lands it at the prompt with its words however Claude Code spaced them: %s', async (_, text, prompt) => {
        const { j } = await sent([[prompt, T0 + 1000]], [message('q1', text, 'delivered')]);
        expect(j.messages(S)[0]).toMatchObject({ state: 'landed', item: `${CONV.slice(-4)}-1:0` });
      });

      it('does not land it at a prompt whose words differ only where a space was left out', async () => {
        const { j } = await sent([['fixit', T0 + 1000]], [message('q1', 'fix it', 'delivered')]);
        expect(j.messages(S)[0].state).toBe('delivered');
      });

      it.each<[string, number, MessageState]>([
        ['a moment before it was sent, by a clock a little off', T0 - 1000, 'landed'],
        ['well before it was sent: an earlier prompt with the same words', T0 - 3000, 'delivered'],
      ])('lands it or not at a prompt from %s', async (_, at, state) => {
        const { j } = await sent([['fix it', at]], [message('q1', 'fix it', 'delivered')]);
        expect(j.messages(S)[0].state).toBe(state);
      });

      it('lands each message of the same words at a prompt of its own', async () => {
        const { j } = await sent([['again', T0 + 5000], ['again', T0 + 6000]], [message('q1', 'again', 'delivered'), message('q2', 'again', 'delivered', T0 + 100)]);
        expect(Object.fromEntries(j.messages(S).map((m) => [m.id, m.item]))).toEqual({ q1: `${CONV.slice(-4)}-1:0`, q2: `${CONV.slice(-4)}-2:0` });
      });

      it('lands the oldest message of the same words first, one a prompt', async () => {
        const { j } = await sent([['again', T0 + 5000]], [message('q2', 'again', 'delivered', T0 + 100), message('q1', 'again', 'enqueued', T0)]);
        expect(Object.fromEntries(j.messages(S).map((m) => [m.id, m.state]))).toEqual({ q1: 'landed', q2: 'delivered' });
      });

      // As Claude Code 2.1.295 records a command typed at its prompt.
      const command = (name: string, args = '') =>
        `<command-name>${name}</command-name>\n            <command-message>${name.slice(1)}</command-message>\n            <command-args>${args}</command-args>`;

      it.each<[string, string, string]>([
        ['a command', '/exit', command('/exit')],
        ['a command with what it takes', '/model opus', command('/model', 'opus')],
        ['a command typed with a space after it', '/clear ', command('/clear')],
      ])('lands %s at the command Claude Code recorded', async (_, typed, recorded) => {
        const { j } = await sent([[recorded, T0 + 1000]], [message('q1', typed, 'delivered')]);
        expect(j.messages(S)[0]).toMatchObject({ state: 'landed', item: `${CONV.slice(-4)}-1:0` });
      });

      it('does not land it at the same command typed well before it was sent', async () => {
        const { j } = await sent([[command('/exit'), T0 - 60_000]], [message('q1', '/exit', 'delivered')]);
        expect(j.messages(S)[0].state).toBe('delivered');
      });

      it('does not land a message at what a command printed', async () => {
        const { j } = await sent([['<local-command-stdout>/exit</local-command-stdout>', T0 + 1000]], [message('q1', '/exit', 'delivered')]);
        expect(j.messages(S)[0].state).toBe('delivered');
      });

      it.each<MessageState>(['queued', 'taken'])('does not land it when it was %s, which never went to Claude', async (state) => {
        const { j } = await sent([['fix it', T0 + 1000]], [message('q1', 'fix it', state)]);
        expect(j.messages(S)[0].state).toBe(state);
      });

      it('enqueues it while Claude holds its words in its own queue, the oldest first for words sent twice', async () => {
        const t = transcript();
        const { j } = open({ root: t.root });
        j.putMessage(S, message('q2', 'and the tests', 'delivered', T0 + 100));
        j.putMessage(S, message('q1', 'and the tests', 'delivered'));
        t.prompt('fix it', T0 - 60_000);
        t.add({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(T0 + 1000), content: 'and the tests' });
        await j.ingest(S, CONV);
        expect(Object.fromEntries(j.messages(S).map((m) => [m.id, m.state]))).toEqual({ q1: 'enqueued', q2: 'delivered' });
      });

      it('enqueues it, and takes it back, when Claude holds its words spaced its own way', async () => {
        const t = transcript();
        const { j } = open({ root: t.root });
        j.putMessage(S, message('q1', '.\tand the tests', 'delivered'));
        t.prompt('fix it', T0 - 60_000);
        const op = (operation: string, at: number) => ({ type: 'queue-operation', operation, timestamp: iso(at), content: '.    and the tests' });
        t.add(op('enqueue', T0 + 1000));
        await j.ingest(S, CONV);
        expect(j.messages(S)[0].state).toBe('enqueued');
        t.add(op('popAll', T0 + 2000));
        await j.ingest(S, CONV);
        expect(j.messages(S)[0].state).toBe('taken');
      });

      describe('pulled back out of Claude\'s queue into the prompt at the Mac (popAll)', () => {
        const op = (operation: string, at: number, content = 'and the tests') => ({ type: 'queue-operation', operation, timestamp: iso(at), content });
        const reads = async (...batches: object[][]) => {
          const t = transcript();
          const o = open({ root: t.root });
          o.j.putMessage(S, message('q1', 'and the tests', 'delivered'));
          t.prompt('fix it', T0 - 60_000);
          for (const batch of batches) {
            for (const e of batch) t.add(e);
            await o.j.ingest(S, CONV);
          }
          return o;
        };

        it.each<[string, object[][], MessageState]>([
          ['enqueued, then pulled back', [[op('enqueue', T0 + 1000)], [op('popAll', T0 + 2000)]], 'taken'],
          ['enqueued and pulled back within one read', [[op('enqueue', T0 + 1000), op('popAll', T0 + 2000)]], 'taken'],
          ['pulled back, changed and sent as a prompt of its own', [[op('enqueue', T0 + 1000)], [op('popAll', T0 + 2000), { type: 'user', timestamp: iso(T0 + 3000), message: { role: 'user', content: 'and the tests too' } }]], 'taken'],
          ['pulled back and put back as it was', [[op('enqueue', T0 + 1000)], [op('popAll', T0 + 2000), op('enqueue', T0 + 3000)]], 'enqueued'],
          ['taken into the turn under way', [[op('enqueue', T0 + 1000)], [op('remove', T0 + 2000)]], 'enqueued'],
          ['not it: the same words pulled back well before it was sent', [[op('enqueue', T0 - 50_000), op('popAll', T0 - 40_000)]], 'delivered'],
        ])('is taken back when %s, or not', async (_, batches, state) => {
          const { j } = await reads(...batches);
          expect(j.messages(S)[0].state).toBe(state);
        });

        it('takes back the message of the words pulled back, one for each time they were', async () => {
          const t = transcript();
          const { j } = open({ root: t.root });
          j.putMessage(S, message('q1', 'and the docs', 'delivered'));
          j.putMessage(S, message('q2', 'and the tests', 'delivered', T0 + 100));
          j.putMessage(S, message('q3', 'and the tests', 'delivered', T0 + 200));
          t.prompt('fix it', T0 - 60_000);
          for (const e of [op('enqueue', T0 + 1000, 'and the docs'), op('enqueue', T0 + 1100), op('enqueue', T0 + 1200), op('popAll', T0 + 2000)]) t.add(e);
          await j.ingest(S, CONV);
          expect(Object.fromEntries(j.messages(S).map((m) => [m.id, m.state]))).toEqual({ q1: 'delivered', q2: 'taken', q3: 'delivered' });
        });

        it('is said in the log', async () => {
          const { logged } = await reads([op('enqueue', T0 + 1000), op('popAll', T0 + 2000)]);
          expect(logged).toContainEqual(['message pulled back at the Mac', { session: S, qid: 'q1' }]);
        });

        it('is not found unconfirmed when the turn ends', async () => {
          const { j } = await reads([op('enqueue', T0 + 1000), op('popAll', T0 + 2000)]);
          j.status(S, 'idle');
          await new Promise((r) => setTimeout(r, 200));
          expect(j.messages(S)[0].state).toBe('taken');
        });
      });

      it("leaves one the turn ended without unconfirmed; one sent after it ended is the next turn's", async () => {
        const t = transcript();
        const { j, logged } = open({ root: t.root });
        t.prompt('first', T0 - 60_000);
        await j.ingest(S, CONV);
        j.putMessage(S, message('q1', 'never typed', 'delivered'));
        j.putMessage(S, message('q2', 'fix it', 'delivered'));
        t.prompt('fix it');
        j.status(S, 'idle');
        j.putMessage(S, message('q3', 'later', 'delivered'));
        await vi.waitFor(() => expect(messagesOf(j)).toEqual({ 'never typed': 'unconfirmed', 'fix it': 'landed', later: 'delivered' }));
        expect(logged).toContainEqual(['message not found in the transcript', { session: S, qid: 'q1', chars: 11 }]);
      });

      it('lands one the transcript had before the server knew it was on its way, when the server starts again', async () => {
        const t = transcript();
        const { j, file } = open({ root: t.root });
        t.prompt('fix it');
        t.prompt('taken already', T0 + 2000);
        await j.ingest(S, CONV);
        j.putMessage(S, { ...message('q0', 'taken already', 'landed'), item: `${CONV.slice(-4)}-2:0` });
        j.putMessage(S, message('q1', 'fix it', 'delivered'));
        j.putMessage(S, message('q2', 'taken already', 'delivered'));
        j.close();
        closing.pop();
        const again = open({ file, root: t.root }).j;
        expect(Object.fromEntries(again.messages(S).map((m) => [m.id, m.state]))).toEqual({ q0: 'landed', q1: 'landed', q2: 'delivered' });
      });
    });
  });
});
