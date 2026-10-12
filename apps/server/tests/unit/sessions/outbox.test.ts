import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Journal } from '../../../src/journal/index.js';
import type { ClaudeStatus } from '../../../src/sessions/machine.js';
import { DomainError } from '../../../src/system/errors.js';
import { Outbox, migrateQueueFile } from '../../../src/sessions/outbox.js';

// The outbox keeps its messages in the journal, as the server does; one made on the same file is the server
// after a restart.
function setup(status: ClaudeStatus | null = 'idle', file = join(mkdtempSync(join(tmpdir(), 'ts-outbox-')), 'journal.db'), gapMs = 0) {
  const journal = new Journal({ file, log: () => {} });
  const statuses = new Map<string, ClaudeStatus | null>([['abc', status]]);
  const delivered: string[] = [];
  const failures: [string, string][] = [];
  const held: [string, string][] = [];
  let failNext = false;
  let unknownNext = false;
  let changes = 0;
  let onDeliver: (text: string) => void = () => {};
  let gate: Promise<void> | null = null;
  const outbox = new Outbox({
    store: journal,
    gapMs,
    status: (id) => statuses.get(id) ?? null,
    deliver: async (id, text) => {
      if (gate) await gate;
      if (unknownNext) {
        unknownNext = false;
        throw Object.assign(new Error('no answer in time'), { mayHaveRun: true });
      }
      if (failNext) {
        failNext = false;
        throw new Error('session gone');
      }
      delivered.push(`${id}:${text}`);
      onDeliver(text);
    },
    changed: () => changes++,
    failed: (id, e) => failures.push([id, (e as Error).message]),
    held: (id, _qid, why) => held.push([id, why instanceof Error ? why.message : String(why)]),
  });
  return {
    outbox,
    file,
    journal,
    delivered,
    failures,
    held,
    // Each message and where it is, as the page reads it from the journal.
    states: () => journal.messages('abc').map((m) => [m.text, m.state]),
    set: (s: ClaudeStatus) => statuses.set('abc', s),
    failOnce: () => (failNext = true),
    // The paste was asked for but never answered: it may have gone in.
    unknownOnce: () => (unknownNext = true),
    onDeliver: (fn: (text: string) => void) => (onDeliver = fn),
    changes: () => changes,
    // Deliveries wait until the returned function is called, as a paste does that takes a while.
    slow: () => {
      let open!: () => void;
      gate = new Promise((r) => (open = r));
      return () => {
        gate = null;
        open();
      };
    },
  };
}
const texts = (o: Outbox) => o.list('abc').map((q) => q.text);

describe('Outbox', () => {
  it('hands a message straight to Claude when it can take it', async () => {
    const { outbox, delivered, states } = setup('idle');
    expect(await outbox.send('abc', 'hi')).toBeNull();
    expect(delivered).toEqual(['abc:hi']);
    expect(outbox.list('abc')).toEqual([]);
    expect(states()).toEqual([['hi', 'delivered']]);
  });

  // Claude reads its own queue at its next step, so nothing need wait on the Mac for the turn to end.
  it("hands a message to Claude's own queue at once while it works", async () => {
    const { outbox, delivered, states } = setup('working');
    expect(await outbox.send('abc', 'meanwhile')).toBeNull();
    expect(delivered).toEqual(['abc:meanwhile']);
    expect(states()).toEqual([['meanwhile', 'enqueued']]);
  });

  it.each(['starting', 'waiting', 'compacting', 'ended'] as const)('holds messages while Claude is %s, and says so', async (status) => {
    const { outbox, delivered, changes } = setup(status);
    const q = await outbox.send('abc', 'first');
    expect(q).toMatchObject({ text: 'first' });
    await outbox.flush('abc');
    expect(delivered).toEqual([]);
    expect(texts(outbox)).toEqual(['first']);
    expect(changes()).toBeGreaterThan(0);
  });

  it('says why each message is held: what Claude is doing, others before it, or a paste that did not go', async () => {
    const { outbox, held, set, failOnce } = setup('waiting');
    await outbox.send('abc', 'asked');
    await outbox.flush('abc');
    set('idle');
    await outbox.send('abc', 'behind');
    await outbox.flush('abc');
    expect(outbox.list('abc'), 'precondition: none left waiting').toEqual([]);
    failOnce();
    await outbox.send('abc', 'refused');
    expect(held).toEqual([
      ['abc', 'waiting'],
      ['abc', 'behind'],
      ['abc', 'session gone'],
    ]);
  });

  it('says nothing is held of a message that goes straight in, or may have', async () => {
    const { outbox, held, unknownOnce } = setup('working');
    await outbox.send('abc', 'meanwhile');
    unknownOnce();
    await outbox.send('abc', 'maybe');
    expect(held).toEqual([]);
  });

  it('keeps what is held through a restart, readable by its owner only', async () => {
    const a = setup('compacting');
    await a.outbox.send('abc', 'one');
    await a.outbox.send('abc', 'two');
    for (const f of [a.file, `${a.file}-wal`]) expect(existsSync(f) && statSync(f).mode & 0o777, f).toBe(0o600);
    const b = setup('compacting', a.file);
    expect(texts(b.outbox)).toEqual(['one', 'two']);
  });

  it('delivers what was held in the order it was sent, once Claude can take it', async () => {
    const { outbox, delivered, set, states } = setup('compacting');
    await outbox.send('abc', 'one');
    await outbox.send('abc', 'two');
    set('idle');
    await outbox.flush('abc');
    expect(delivered).toEqual(['abc:one', 'abc:two']);
    expect(outbox.list('abc')).toEqual([]);
    expect(states()).toEqual([
      ['one', 'delivered'],
      ['two', 'delivered'],
    ]);
  });

  it('puts a message sent while others are held behind them, even when Claude could take it', async () => {
    const { outbox, delivered, set, onDeliver } = setup('compacting');
    await outbox.send('abc', 'one');
    set('idle');
    let late: Promise<unknown> | undefined;
    onDeliver((t) => {
      if (t === 'one') late = outbox.send('abc', 'three');
    });
    await outbox.send('abc', 'two');
    await outbox.flush('abc');
    await late;
    await outbox.flush('abc');
    expect(delivered).toEqual(['abc:one', 'abc:two', 'abc:three']);
  });

  it('delivers each message once when asked to flush twice at the same time', async () => {
    const { outbox, delivered, set } = setup('compacting');
    await outbox.send('abc', 'one');
    await outbox.send('abc', 'two');
    set('idle');
    await Promise.all([outbox.flush('abc'), outbox.flush('abc'), outbox.flush('abc')]);
    expect(delivered).toEqual(['abc:one', 'abc:two']);
  });

  it('stops between messages when Claude starts compacting again', async () => {
    const { outbox, delivered, set, onDeliver } = setup('compacting');
    await outbox.send('abc', 'one');
    await outbox.send('abc', 'two');
    set('idle');
    onDeliver(() => set('compacting'));
    await outbox.flush('abc');
    expect(delivered).toEqual(['abc:one']);
    expect(texts(outbox)).toEqual(['two']);
  });

  it('keeps a message it could not deliver, and delivers it on the next try', async () => {
    const { outbox, delivered, set, failOnce } = setup('compacting');
    await outbox.send('abc', 'one');
    set('idle');
    failOnce();
    await outbox.flush('abc');
    expect(texts(outbox)).toEqual(['one']);
    await outbox.flush('abc');
    expect(delivered).toEqual(['abc:one']);
  });

  it('holds a message that cannot be delivered at once, and does not lose it', async () => {
    const { outbox, failOnce } = setup('idle');
    failOnce();
    await expect(outbox.send('abc', 'one')).resolves.toMatchObject({ text: 'one' });
    expect(texts(outbox)).toEqual(['one']);
  });

  it('takes back a held message and gives its text back', async () => {
    const { outbox } = setup('compacting');
    const one = (await outbox.send('abc', 'one'))!;
    await outbox.send('abc', 'two');
    expect(outbox.remove('abc', one.id)).toBe('one');
    expect(outbox.remove('abc', one.id)).toBeNull();
    expect(outbox.remove('zzz', one.id)).toBeNull();
    expect(texts(outbox)).toEqual(['two']);
  });

  it('does not deliver a message taken back while it waited its turn', async () => {
    const { outbox, delivered, set, onDeliver } = setup('compacting', undefined, 100);
    await outbox.send('abc', 'one');
    const two = (await outbox.send('abc', 'two'))!;
    set('idle');
    onDeliver((t) => {
      if (t === 'one') setTimeout(() => outbox.remove('abc', two.id), 20);
    });
    await outbox.flush('abc');
    expect(delivered).toEqual(['abc:one']);
  });

  // A send whose answer was lost on the way is sent again with the id the page gave it.
  it.each(['idle', 'compacting'] as const)('takes a message sent again under the same id once, while Claude is %s', async (status) => {
    const { outbox, delivered, set } = setup(status);
    const first = await outbox.send('abc', 'once', 'page-id-1');
    expect(await outbox.send('abc', 'once', 'page-id-1')).toEqual(first);
    set('idle');
    await outbox.flush('abc');
    expect(delivered).toEqual(['abc:once']);
  });

  it('takes a message sent again under the same id once, after it went in', async () => {
    const { outbox, delivered } = setup('idle');
    await outbox.send('abc', 'once', 'page-id-2');
    expect(await outbox.send('abc', 'once', 'page-id-2')).toBeNull();
    expect(delivered).toEqual(['abc:once']);
  });

  // A send retried while the first is still being pasted: the page timed out, the paste had not.
  describe('when a message is sent again while it is still being delivered', () => {
    it('sends it to Claude once, and gives both sends the same answer', async () => {
      const { outbox, delivered, slow, states } = setup('idle');
      const done = slow();
      const first = outbox.send('abc', 'once', 'race-1');
      const again = outbox.send('abc', 'once', 'race-1');
      done();
      expect(await Promise.all([first, again])).toEqual([null, null]);
      expect(delivered).toEqual(['abc:once']);
      expect(states()).toEqual([['once', 'delivered']]);
    });

    it('holds it once when that delivery fails, gives both sends the held message, and sends it on the next try', async () => {
      const { outbox, delivered, slow, failOnce } = setup('idle');
      failOnce();
      const done = slow();
      const first = outbox.send('abc', 'once', 'race-2');
      const again = outbox.send('abc', 'once', 'race-2');
      done();
      const [a, b] = await Promise.all([first, again]);
      expect(a).toMatchObject({ id: 'race-2', text: 'once' });
      expect(b).toEqual(a);
      expect(outbox.list('abc').map((q) => q.id)).toEqual(['race-2']);
      expect(delivered).toEqual([]);
      await outbox.flush('abc');
      expect(delivered).toEqual(['abc:once']);
    });

    it('sends it once when it is being sent out of its turn', async () => {
      const { outbox, delivered, slow, set } = setup('compacting');
      await outbox.send('abc', 'now', 'race-3');
      set('idle');
      const done = slow();
      const now = outbox.sendNow('abc', 'race-3');
      const again = outbox.send('abc', 'now', 'race-3');
      done();
      expect(await now).toBe(true);
      expect(await again).toBeNull();
      expect(delivered).toEqual(['abc:now']);
    });

    it('lets it go again once the delivery that failed is over and the message was taken back', async () => {
      const { outbox, delivered, slow, failOnce } = setup('idle');
      failOnce();
      const done = slow();
      const first = outbox.send('abc', 'again', 'race-5');
      done();
      await first;
      expect(outbox.remove('abc', 'race-5')).toBe('again');
      expect(await outbox.send('abc', 'again', 'race-5')).toBeNull();
      expect(delivered).toEqual(['abc:again']);
    });

    it('sends it once when it is being delivered in its turn', async () => {
      const { outbox, delivered, slow, set } = setup('compacting');
      const held = await outbox.send('abc', 'turn', 'race-4');
      const done = slow();
      set('idle');
      const flushing = outbox.flush('abc');
      await Promise.resolve();
      const again = outbox.send('abc', 'turn', 'race-4');
      done();
      await flushing;
      expect([null, held]).toContainEqual(await again);
      expect(delivered).toEqual(['abc:turn']);
    });
  });

  // Typed again, a message that did go in would be there twice; one that did not can be sent again by hand.
  describe('when a delivery may have gone in', () => {
    it('counts it as sent and does not try again, when it was sent straight away', async () => {
      const { outbox, delivered, unknownOnce, states } = setup('idle');
      unknownOnce();
      expect(await outbox.send('abc', 'maybe', 'maybe-1')).toBeNull();
      expect(outbox.list('abc')).toEqual([]);
      expect(states()).toEqual([['maybe', 'delivered']]);
      await outbox.flush('abc');
      expect(await outbox.send('abc', 'maybe', 'maybe-1')).toBeNull();
      expect(delivered).toEqual([]);
    });

    it('counts it as sent and does not try again, when it waited its turn', async () => {
      const { outbox, delivered, unknownOnce, set, states } = setup('compacting');
      await outbox.send('abc', 'maybe', 'maybe-2');
      await outbox.send('abc', 'next', 'maybe-3');
      unknownOnce();
      set('idle');
      await outbox.flush('abc');
      expect(outbox.list('abc')).toEqual([]);
      expect(states()).toEqual([
        ['maybe', 'delivered'],
        ['next', 'delivered'],
      ]);
      expect(delivered).toEqual(['abc:next']);
    });

    it('counts it as sent when it was sent out of its turn', async () => {
      const { outbox, unknownOnce, set, states } = setup('compacting');
      await outbox.send('abc', 'maybe', 'maybe-4');
      set('idle');
      unknownOnce();
      expect(await outbox.sendNow('abc', 'maybe-4')).toBe(true);
      expect(outbox.list('abc')).toEqual([]);
      expect(states()).toEqual([['maybe', 'delivered']]);
    });
  });

  it('sends only the one asked for now; the rest wait until Claude can take them', async () => {
    const { outbox, delivered, set } = setup('waiting');
    const first = await outbox.send('abc', 'first');
    await outbox.send('abc', 'second');
    expect(await outbox.sendNow('abc', first!.id)).toBe(true);
    await outbox.flush('abc');
    expect(delivered).toEqual(['abc:first']);
    expect(texts(outbox)).toEqual(['second']);
    set('idle');
    await outbox.flush('abc');
    expect(delivered).toEqual(['abc:first', 'abc:second']);
  });

  describe('sendNow', () => {
    it('does nothing for a message that is not waiting', async () => {
      const { outbox, delivered } = setup('waiting');
      expect(await outbox.sendNow('abc', 'never-sent')).toBe(false);
      expect(delivered).toEqual([]);
    });

    it('fails when the paste does, and the message waits first, ahead of those that were', async () => {
      const { outbox, failOnce, failures, states } = setup('waiting');
      await outbox.send('abc', 'a');
      await outbox.send('abc', 'b');
      const c = await outbox.send('abc', 'c');
      failOnce();
      const e = await outbox.sendNow('abc', c!.id).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(DomainError);
      expect([(e as DomainError).status, (e as DomainError).message]).toEqual([503, 'not sent']);
      expect(texts(outbox)).toEqual(['c', 'a', 'b']);
      expect(states()).toEqual(expect.arrayContaining([['c', 'queued']]));
      expect(failures).toEqual([['abc', 'session gone']]);
    });

    it('puts the last one that could not go first', async () => {
      const { outbox, failOnce } = setup('waiting');
      await outbox.send('abc', 'a');
      const b = await outbox.send('abc', 'b');
      const c = await outbox.send('abc', 'c');
      failOnce();
      await expect(outbox.sendNow('abc', b!.id)).rejects.toThrow('not sent');
      failOnce();
      await expect(outbox.sendNow('abc', c!.id)).rejects.toThrow('not sent');
      expect(texts(outbox)).toEqual(['c', 'b', 'a']);
    });
  });

  describe('when a message could not go', () => {
    it.each<[string, (o: ReturnType<typeof setup>) => Promise<unknown>]>([
      ['when sent', async ({ outbox }) => outbox.send('abc', 'hi')],
      ['when its turn came', async ({ outbox, set }) => {
        set('waiting');
        await outbox.send('abc', 'hi');
        set('idle');
        return outbox.flush('abc');
      }],
    ])('tells of it with why, %s', async (_, go) => {
      const o = setup('idle');
      o.failOnce();
      await go(o);
      expect(o.failures).toEqual([['abc', 'session gone']]);
      expect(texts(o.outbox)).toEqual(['hi']);
    });
  });

  describe('move', () => {
    const three = async () => {
      const o = setup('waiting');
      const ids: string[] = [];
      for (const t of ['a', 'b', 'c']) ids.push((await o.outbox.send('abc', t))!.id);
      return { ...o, ids };
    };

    it('swaps it with the one before or after, and they go in that order', async () => {
      const { outbox, ids, set, delivered } = await three();
      expect(outbox.move('abc', ids[1], -1)).toBe(true);
      expect(texts(outbox)).toEqual(['b', 'a', 'c']);
      expect(outbox.move('abc', ids[1], 1)).toBe(true);
      expect(outbox.move('abc', ids[1], 1)).toBe(true);
      expect(texts(outbox)).toEqual(['a', 'c', 'b']);
      set('idle');
      await outbox.flush('abc');
      expect(delivered).toEqual(['abc:a', 'abc:c', 'abc:b']);
    });

    it('leaves it where it is at either end, and tells no one of a change', async () => {
      const { outbox, ids, changes } = await three();
      const before = changes();
      expect(outbox.move('abc', ids[0], -1)).toBe(true);
      expect(outbox.move('abc', ids[2], 1)).toBe(true);
      expect(texts(outbox)).toEqual(['a', 'b', 'c']);
      expect(changes()).toBe(before);
    });

    it('does nothing for a message that is not waiting any more', async () => {
      const { outbox, ids } = await three();
      outbox.remove('abc', ids[1]);
      expect(outbox.move('abc', ids[1], -1)).toBe(false);
      expect(outbox.move('abc', 'never-sent', 1)).toBe(false);
      expect(texts(outbox)).toEqual(['a', 'c']);
    });

    it('puts it in its new place even in the gap between two that go', async () => {
      const o = setup('waiting', undefined, 60);
      const ids: string[] = [];
      for (const t of ['a', 'b', 'c']) ids.push((await o.outbox.send('abc', t))!.id);
      o.onDeliver((text) => {
        if (text === 'a') setTimeout(() => o.outbox.move('abc', ids[2], -1), 20);
      });
      o.set('idle');
      await o.outbox.flush('abc');
      expect(o.delivered).toEqual(['abc:a', 'abc:c', 'abc:b']);
    });
  });
});

describe('migrateQueueFile', () => {
  const home = () => mkdtempSync(join(tmpdir(), 'ts-queue-'));

  it('reads it into the journal once, each message where it was, and sets it aside', () => {
    const dir = home();
    const file = join(dir, 'queue.json');
    const old = {
      done: { abc: ['landed-1'] },
      sent: { abc: [{ id: 'sent-1', text: 'went', at: 5 }] },
      sessions: { abc: [{ id: 'q-1', text: 'first', at: 6 }, { id: 'q-2', text: 'second', at: 7 }], other: [{ id: 'q-3', text: 'elsewhere', at: 8 }] },
    };
    writeFileSync(file, JSON.stringify(old));
    const o = setup('waiting', join(dir, 'journal.db'));
    o.journal.putMessage('abc', { id: 'q-1', text: 'first', sentAt: 6, state: 'delivered', ord: null, item: null });
    migrateQueueFile(file, o.journal);
    expect(o.journal.messages('abc').map((m) => [m.id, m.text, m.sentAt, m.state, m.ord])).toEqual(
      expect.arrayContaining([
        ['landed-1', '', 0, 'landed', null],
        ['sent-1', 'went', 5, 'delivered', null],
        ['q-1', 'first', 6, 'delivered', null],
        ['q-2', 'second', 7, 'queued', 2],
      ]),
    );
    expect(o.journal.messages('abc')).toHaveLength(4);
    expect(o.outbox.list('other')).toEqual([{ id: 'q-3', text: 'elsewhere', at: 8 }]);
    expect(existsSync(file)).toBe(false);
    expect(JSON.parse(readFileSync(`${file}.migrated`, 'utf8'))).toEqual(old);
    migrateQueueFile(file, o.journal);
    expect(o.journal.messages('abc')).toHaveLength(4);
  });

  it('reads it even when it has only some of its parts', () => {
    const dir = home();
    const file = join(dir, 'queue.json');
    writeFileSync(file, JSON.stringify({ sessions: { abc: [{ id: 'q-1', text: 'first', at: 6 }] } }));
    const o = setup('waiting', join(dir, 'journal.db'));
    migrateQueueFile(file, o.journal);
    expect(texts(o.outbox)).toEqual(['first']);
  });
});
