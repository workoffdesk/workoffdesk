import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { Journal, type Row } from '../../../src/journal/index.js';
import type { Machine } from '../../../src/sessions/machine.js';
import { serveSession, type JournalSource } from '../../../src/http/sessionSocket.js';

// A phone's line to one session, against a socket that keeps what is sent on it and a machine whose screen
// the test says.
const ID = 'abc';
const CONV = '0199dddd-0000-7000-8000-000000000001';

class Line extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  ping() {}
  close(code: number) {
    if (this.readyState !== this.OPEN) return;
    this.closedWith = code;
    this.readyState = 3;
    this.emit('close');
  }
  say(msg: object) {
    this.emit('message', Buffer.from(JSON.stringify(msg)), false);
  }
  type(text: string) {
    this.emit('message', Buffer.from(text), true);
  }
  of(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
}

const deferred = () => {
  let resolve!: () => void;
  const p = new Promise<void>((r) => (resolve = r));
  return { p, resolve };
};

const lines: Line[] = [];
const journals: Journal[] = [];
afterEach(() => {
  for (const l of lines.splice(0)) l.close(1000);
  for (const j of journals.splice(0)) j.close();
  vi.useRealTimers();
});

const serve = async (o: { there?: () => Promise<boolean>; fit?: () => Promise<void>; source?: JournalSource; withJournal?: boolean } = {}) => {
  const line = new Line();
  lines.push(line);
  const journal = new Journal({ file: ':memory:', log: () => {} });
  journals.push(journal);
  const m = {
    there: true,
    screen: { choices: null } as unknown,
    text: 'prompt $',
    typed: [] as string[],
    typing: null as Promise<void> | null,
    reading: null as Promise<void> | null,
    changed: [] as (() => void)[],
    screenReads: 0,
    ingested: 0,
    visibility: [] as [string, boolean][],
  };
  const machine = {
    exists: o.there ?? (async () => m.there),
    fitForChat: o.fit ?? (async () => {}),
    onChange: (cb: () => void) => {
      m.changed.push(cb);
      return () => (m.changed = m.changed.filter((c) => c !== cb));
    },
    onScreen: async () => (m.screenReads++, m.screen),
    screenText: async () => {
      const text = m.text;
      await m.reading;
      return text;
    },
    type: async (_id: string, text: string) => {
      m.typed.push(text);
      await m.typing;
    },
  } as unknown as Machine;
  const source: JournalSource = o.source ?? {
    ingest: async () => void m.ingested++,
    sync: (id, epoch, v) => journal.sync(id, epoch, v),
    onRows: (id, cb) => journal.onRows(id, cb),
  };
  const served = serveSession(line as unknown as WebSocket, ID, machine, (_id, conn, visible) => m.visibility.push([conn, visible]), o.withJournal === false ? undefined : source);
  return { line, m, journal, served };
};

describe('serveSession', () => {
  it('tells the page the session is not there, and closes the line', async () => {
    const { line, served } = await serve({ there: async () => false });
    await served;
    expect(line.sent).toEqual([{ type: 'exit' }]);
    expect(line.closedWith).toBe(4404);
  });

  it('loses nothing the page sends before the session is found', async () => {
    const found = deferred();
    const { line, m, served } = await serve({ there: async () => (await found.p, true) });
    line.type('ls\n');
    line.say({ type: 'visible', visible: true });
    expect(m.typed).toEqual([]);
    found.resolve();
    await served;
    await vi.waitFor(() => expect(m.typed).toEqual(['ls\n']));
    await vi.waitFor(() => expect(line.of('screen')).toHaveLength(1));
  });

  it('types what is sent in order, each once the one before is in, and nothing once closed', async () => {
    const { line, m, served } = await serve();
    await served;
    const slow = deferred();
    m.typing = slow.p;
    line.type('a');
    line.type('b');
    await vi.waitFor(() => expect(m.typed).toEqual(['a']));
    await new Promise((r) => setTimeout(r, 20));
    expect(m.typed).toEqual(['a']);
    line.close(1000);
    slow.resolve();
    await new Promise((r) => setTimeout(r, 20));
    expect(m.typed).toEqual(['a']);
  });

  it('tells the page when the session ends, and closes the line', async () => {
    const { line, m, served } = await serve();
    await served;
    m.changed[0]();
    await new Promise((r) => setTimeout(r, 0));
    expect(line.closedWith).toBeNull();
    m.there = false;
    m.changed[0]();
    await vi.waitFor(() => expect(line.closedWith).toBe(1000));
    expect(line.of('exit')).toHaveLength(1);
    expect(m.changed).toEqual([]);
  });

  it.each(['while it is looked for', 'while it is fitted for the chat'])('tells the page a session that ends %s, and closes the line', async (when) => {
    const looked = deferred();
    const fitted = deferred();
    let there = true;
    let first = true;
    const { line, m, served } = await serve({
      there: async () => {
        if (!first) return there;
        first = false;
        if (when === 'while it is looked for') await looked.p;
        return true;
      },
      fit: async () => {
        if (when === 'while it is fitted for the chat') await fitted.p;
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    there = false;
    for (const cb of [...m.changed]) cb();
    looked.resolve();
    fitted.resolve();
    await served;
    await vi.waitFor(() => expect(line.closedWith).not.toBeNull());
    expect(line.of('exit')).toHaveLength(1);
  });

  it('passes over what it cannot read', async () => {
    const { line, served } = await serve();
    await served;
    line.emit('message', Buffer.from('{not json'), false);
    line.say({ type: 'nothing we know' });
    expect(line.sent).toEqual([]);
  });

  describe("with the page's copy of the journal", () => {
    const rows = (line: Line) => line.of('journal').flatMap((m) => (m.rows as Row[]).map((r) => r.v));

    it('catches the copy up a page at a time from where it says it is, after what the transcript added, then tells it each change', async () => {
      const { line, m, journal, served } = await serve();
      await served;
      journal.onMac(ID, 1);
      journal.putAgentItems(ID, CONV, Array.from({ length: 1200 }, (_, i) => ({ id: `a${i}`, item: { k: 'text' as const, text: `${i}` } })));
      line.say({ type: 'journal', epoch: journal.epoch, v: 1 });
      await vi.waitFor(() => expect(line.of('journal').at(-1)?.more).toBe(false));
      expect(m.ingested).toBe(1);
      expect(line.of('journal').map((x) => [x.from, x.v, (x.rows as Row[]).length, x.more])).toEqual([
        [1, 501, 500, true],
        [501, 1001, 500, true],
        [1001, 1202, 201, false],
      ]);
      journal.onMac(ID, 2);
      expect(line.of('journal').at(-1)).toEqual({ type: 'journal', from: 1202, v: 1203, rows: [{ t: 'state', key: 'onMac', v: 1203, body: 2 }] });
      const all = rows(line);
      expect(all).toEqual(Array.from({ length: 1202 }, (_, i) => i + 2));
    });

    it('starts over a copy of another journal, and puts in it once what was written while it was caught up', async () => {
      const ingested = deferred();
      const journal = new Journal({ file: ':memory:', log: () => {} });
      journals.push(journal);
      const { line, served } = await serve({
        source: { ingest: () => ingested.p, sync: (id, e, v) => journal.sync(id, e, v), onRows: (id, cb) => journal.onRows(id, cb) },
      });
      await served;
      journal.onMac(ID, 1);
      line.say({ type: 'journal', epoch: 'another', v: 9 });
      journal.onMac(ID, 2);
      ingested.resolve();
      await vi.waitFor(() => expect(line.of('journal')).toHaveLength(1));
      expect(line.of('journal')[0]).toMatchObject({ from: 9, reset: true, v: 2, rows: [{ key: 'onMac', v: 2, body: 2 }] });
      journal.onMac(ID, 3);
      expect(rows(line)).toEqual([2, 3]);
    });

    it('gives a copy asked again once caught up, once, what was written while it was caught up again', async () => {
      let ingest = Promise.resolve();
      const journal = new Journal({ file: ':memory:', log: () => {} });
      journals.push(journal);
      const { line, served } = await serve({ source: { ingest: () => ingest, sync: (id, e, v) => journal.sync(id, e, v), onRows: (id, cb) => journal.onRows(id, cb) } });
      await served;
      journal.onMac(ID, 1);
      line.say({ type: 'journal', epoch: journal.epoch, v: 0 });
      await vi.waitFor(() => expect(line.of('journal')).toHaveLength(1));
      const again = deferred();
      ingest = again.p;
      line.say({ type: 'journal', epoch: journal.epoch, v: 1 });
      journal.onMac(ID, 2);
      again.resolve();
      await vi.waitFor(() => expect(line.of('journal')).toHaveLength(2));
      await new Promise((r) => setTimeout(r, 10));
      expect(rows(line)).toEqual([1, 2]);
    });

    it('tells it nothing until the page says where it is', async () => {
      const { line, journal, served } = await serve();
      await served;
      journal.onMac(ID, 1);
      expect(line.sent).toEqual([]);
    });

    it.each([-1, 1.5, '3', null])('does not catch it up from %j', async (v) => {
      const { line, m, served } = await serve();
      await served;
      line.say({ type: 'journal', v });
      await new Promise((r) => setTimeout(r, 10));
      expect([m.ingested, line.sent]).toEqual([0, []]);
    });

    it('sends only what it does not have of a change, and nothing of one it is behind', async () => {
      let told: (from: number, to: number, rows: Row[]) => void = () => {};
      let listening = false;
      const row = (v: number): Row => ({ t: 'state', key: `s${v}`, v, body: v });
      const { line, served } = await serve({
        source: { ingest: async () => {}, sync: () => ({ epoch: 'e', v: 6, rows: [], more: false }), onRows: (_id, cb) => ((told = cb), (listening = true), () => (listening = false)) },
      });
      await served;
      line.say({ type: 'journal', epoch: 'e', v: 6 });
      await vi.waitFor(() => expect(line.of('journal')).toHaveLength(1));
      told(5, 8, [row(6), row(7), row(8)]);
      expect(line.of('journal').at(-1)).toEqual({ type: 'journal', from: 6, v: 8, rows: [row(7), row(8)] });
      told(8, 8, []);
      told(9, 12, [row(10)]);
      told(4, 7, [row(5)]);
      expect(line.of('journal')).toHaveLength(2);
      expect(listening).toBe(true);
      line.close(1000);
      expect(listening).toBe(false);
    });

    it('does not keep it up once the line is closed', async () => {
      const { line, journal, served } = await serve();
      await served;
      line.say({ type: 'journal', epoch: journal.epoch, v: 0 });
      await vi.waitFor(() => expect(line.of('journal')).toHaveLength(1));
      line.close(1000);
      journal.onMac(ID, 1);
      expect(line.of('journal')).toHaveLength(1);
    });
  });

  describe('with the screen, while the page is looked at', () => {
    it('sends it when the page is looked at, then each time it changes, and says the line alive while it does not', async () => {
      vi.useFakeTimers();
      const { line, m, served } = await serve();
      await served;
      line.say({ type: 'visible', visible: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(line.of('screen')).toEqual([{ type: 'screen', screen: { choices: null } }]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(line.of('screen')).toHaveLength(1);
      expect(line.of('alive')).toEqual([]);
      m.screen = { choices: { question: 'Go on?' } };
      await vi.advanceTimersByTimeAsync(250);
      expect(line.of('screen').at(-1)).toEqual({ type: 'screen', screen: { choices: { question: 'Go on?' } } });
      await vi.advanceTimersByTimeAsync(4250);
      expect(line.of('alive')).toHaveLength(1);
    });

    it('does not read it while the page is not looked at, and sends it again when it is', async () => {
      vi.useFakeTimers();
      const { line, m, served } = await serve();
      await served;
      line.say({ type: 'visible', visible: true });
      await vi.advanceTimersByTimeAsync(0);
      line.say({ type: 'visible', visible: false });
      const reads = m.screenReads;
      await vi.advanceTimersByTimeAsync(5000);
      expect(m.screenReads).toBe(reads);
      expect(line.sent.filter((x) => x.type !== 'screen')).toEqual([]);
      line.say({ type: 'visible', visible: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(line.of('screen')).toHaveLength(2);
      expect(m.visibility.map(([, v]) => v)).toEqual([true, false, true]);
    });

    it('does not send it when the page asks while it is not looked at', async () => {
      vi.useFakeTimers();
      const { line, served } = await serve();
      await served;
      line.say({ type: 'screen' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(line.sent).toEqual([]);
    });

    it('reads it once a quarter second, however often the page says it is looked at', async () => {
      vi.useFakeTimers();
      const { line, m, served } = await serve();
      await served;
      for (let i = 0; i < 4; i++) {
        line.say({ type: 'visible', visible: true });
        await vi.advanceTimersByTimeAsync(10);
      }
      const reads = m.screenReads;
      await vi.advanceTimersByTimeAsync(1000);
      expect(m.screenReads - reads).toBe(4);
    });

    it('reads it one reading at a time, asked for at once from several sides', async () => {
      vi.useFakeTimers();
      const { line, m, served } = await serve();
      await served;
      line.say({ type: 'visible', visible: true });
      line.say({ type: 'screen' });
      line.say({ type: 'screen' });
      await vi.advanceTimersByTimeAsync(0);
      expect([m.screenReads, line.of('screen').length]).toEqual([1, 1]);
    });

    it('sends it at once when the page asks, whether or not it changed', async () => {
      vi.useFakeTimers();
      const { line, served } = await serve();
      await served;
      line.say({ type: 'visible', visible: true });
      await vi.advanceTimersByTimeAsync(0);
      line.say({ type: 'screen' });
      await vi.advanceTimersByTimeAsync(0);
      expect(line.of('screen')).toHaveLength(2);
    });

    it('says the page is no longer looked at once the line is closed, and reads it no more', async () => {
      vi.useFakeTimers();
      const { line, m, served } = await serve();
      await served;
      line.say({ type: 'visible', visible: true });
      await vi.advanceTimersByTimeAsync(0);
      line.close(1000);
      const reads = m.screenReads;
      await vi.advanceTimersByTimeAsync(5000);
      expect(m.screenReads).toBe(reads);
      expect(m.visibility.at(-1)?.[1]).toBe(false);
    });
  });

  describe('with the screen as text, while it is watched', () => {
    it('sends it when watched and each time it changes, soon after a key, and not once it is not watched', async () => {
      vi.useFakeTimers();
      const { line, m, served } = await serve();
      await served;
      line.say({ type: 'screenText', on: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(line.of('screenText')).toEqual([{ type: 'screenText', text: 'prompt $' }]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(line.of('screenText')).toHaveLength(1);
      line.type('l');
      m.text = 'prompt $ l';
      await vi.advanceTimersByTimeAsync(300);
      expect(line.of('screenText').at(-1)).toEqual({ type: 'screenText', text: 'prompt $ l' });
      m.text = 'prompt $ ls';
      await vi.advanceTimersByTimeAsync(1000);
      expect(line.of('screenText')).toHaveLength(3);
      line.say({ type: 'screenText', on: false });
      m.text = 'gone';
      await vi.advanceTimersByTimeAsync(3000);
      expect(line.of('screenText')).toHaveLength(3);
    });

    it('reads it again as soon as a reading is back when a key came meanwhile', async () => {
      vi.useFakeTimers();
      const { line, m, served } = await serve();
      await served;
      line.say({ type: 'screenText', on: true });
      await vi.advanceTimersByTimeAsync(0);
      const slow = deferred();
      m.reading = slow.p;
      await vi.advanceTimersByTimeAsync(1000);
      m.reading = null;
      m.text = 'prompt $ l';
      line.type('l');
      await vi.advanceTimersByTimeAsync(300);
      slow.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(line.of('screenText').at(-1)).toEqual({ type: 'screenText', text: 'prompt $ l' });
    });

    it('does not send a reading made when the page stopped watching it', async () => {
      vi.useFakeTimers();
      const { line, m, served } = await serve();
      await served;
      line.say({ type: 'screenText', on: true });
      await vi.advanceTimersByTimeAsync(0);
      const slow = deferred();
      m.reading = slow.p;
      m.text = 'changed';
      await vi.advanceTimersByTimeAsync(1000);
      line.say({ type: 'screenText', on: false });
      slow.resolve();
      await vi.advanceTimersByTimeAsync(3000);
      expect(line.of('screenText')).toEqual([{ type: 'screenText', text: 'prompt $' }]);
    });

    it('sends it again when watched again, even unchanged', async () => {
      vi.useFakeTimers();
      const { line, served } = await serve();
      await served;
      line.say({ type: 'screenText', on: true });
      await vi.advanceTimersByTimeAsync(0);
      line.say({ type: 'screenText', on: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(line.of('screenText')).toHaveLength(2);
    });
  });
});
