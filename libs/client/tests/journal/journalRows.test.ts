import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Turn } from '../../src/model/chat';
import { applyRows, chatPending, emptyView, onShow, queue, type Message, type SessionView } from '../../src/journal/journalRows';
import { journalHeads } from '../../src/journal/pushes';
import { item, message, state } from '../helpers/journal';

// A copy of the journal as rows are applied to it, and what a session page reads off it.
beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  journalHeads(null);
});

describe('applyRows', () => {
  const copy = () => ({ epoch: 'e1', v: 0, items: new Map(), messages: new Map(), states: new Map(), older: null });
  const rows = [state('status', 'idle', 1), state('status', 'working', 3), state('status', 'waiting', 2), message({ id: 'q1', state: 'delivering' }, 1), message({ id: 'q1', state: 'landed' }, 4)];
  const orders = [rows, [...rows].reverse(), [rows[1], rows[4], rows[0], rows[3], rows[2]], [...rows, ...rows]];

  it.each(orders.map((o, i) => [i, o] as const))('ends the same whatever order and however often the rows come (%s)', (_, order) => {
    const c = copy();
    applyRows(c, order);
    expect(c.states.get('status')).toEqual({ v: 3, body: 'working' });
    expect(c.messages.get('q1')).toMatchObject({ v: 4, body: { state: 'landed' } });
  });

  it('skips a row at the version it already holds', () => {
    const c = copy();
    applyRows(c, [state('status', 'idle', 2), state('status', 'working', 2)]);
    expect(c.states.get('status')!.body).toBe('idle');
  });

  it('never changes a turn once it has it', () => {
    const c = copy();
    applyRows(c, [item('i1', 1)]);
    applyRows(c, [{ ...item('i1', 9), v: 99 }]);
    expect(c.items.get('i1')).toMatchObject({ pos: 1, itemId: 'i1' });
  });

  it('starts over on a reset, keeping only what this device is still sending', () => {
    const c = copy();
    applyRows(c, [item('i1', 1), state('status', 'idle'), message({ id: 'q1', state: 'sending' }, 0), message({ id: 'q2', state: 'landed' })]);
    applyRows(c, [item('i2', 2)], true);
    expect([...c.items.keys()]).toEqual(['i2']);
    expect(c.states.size).toBe(0);
    expect([...c.messages.keys()]).toEqual(['q1']);
  });
});

describe('queue', () => {
  const v = (messages: Message[], status: SessionView['status'] = 'idle'): SessionView => ({ ...emptyView, status, messages });
  const m = (id: string, s: Message['state'], o: Partial<Message> = {}): Message => ({ id, text: id, sentAt: 1, state: s, ord: null, item: null, ...o });

  it("lists Claude's own queue, then what the Mac holds in order, then what is on its way", () => {
    const messages = [m('sending', 'sending', { sentAt: 1 }), m('mac2', 'queued', { ord: 2 }), m('claude', 'enqueued'), m('mac1', 'queued', { ord: 1 }), m('sending2', 'sending', { sentAt: 0 })];
    expect(queue(v(messages), new Set()).map((q) => [q.id, q.waits])).toEqual([
      ['claude', 'claude'],
      ['mac1', 'mac'],
      ['mac2', 'mac'],
      ['sending2', 'sending'],
      ['sending', 'sending'],
    ]);
  });

  it('leaves out what is being taken back and what has left the queue', () => {
    const messages = [m('a', 'queued', { ord: 1 }), m('b', 'queued', { ord: 2 }), m('c', 'landed'), m('d', 'delivered'), m('e', 'taken'), m('f', 'unconfirmed')];
    expect(queue(v(messages), new Set(['a'])).map((q) => q.id)).toEqual(['b']);
  });

  it.each<[string, SessionView['status'], boolean]>([
    ['Claude works', 'working', true],
    ['Claude starts', 'starting', true],
    ['Claude waits on the person', 'waiting', true],
    ['Claude compacts', 'compacting', true],
    ['the session ended', 'ended', true],
    ['Claude is idle', 'idle', false],
    ['nothing is known', null, false],
  ])('holds a message on its way while %s', (_, status, listed) => {
    expect(queue(v([m('a', 'sending')], status), new Set()).length).toBe(listed ? 1 : 0);
  });

  it('holds a message on its way behind others the Mac holds while Claude is idle', () => {
    expect(queue(v([m('a', 'sending'), m('b', 'queued', { ord: 1 })]), new Set()).map((q) => q.id)).toEqual(['b', 'a']);
  });

  it('says when each was sent', () => {
    expect(queue(v([m('a', 'queued', { sentAt: 42, ord: 1 })]), new Set())).toEqual([{ id: 'a', text: 'a', at: 42, waits: 'mac' }]);
  });
});

describe('onShow', () => {
  const view = (messages: Message[], o: Partial<SessionView> = {}): SessionView => ({
    ...emptyView,
    status: 'idle',
    items: [{ k: 'user', text: 'go', itemId: 'i7', pos: 7, conv: 'c1' }],
    messages,
    ...o,
  });
  const m = (id: string, s: Message['state'], o: Partial<Message> = {}): Message => ({ id, text: id, sentAt: 1000, state: s, ord: null, item: null, ...o });
  const prompt = (key: string, at?: string): Turn => ({ k: 'user', text: 'go', key, ...(at && { at }) });
  const reply: Turn = { k: 'text', text: 'ok', key: '8' };

  it('marks the last prompt sent while it is the last turn and a message landed as it', () => {
    expect(onShow(view([m('a', 'landed', { item: 'i7' })]), [prompt('7')]).sent).toEqual(new Set(['7']));
    expect(onShow(view([m('a', 'landed', { item: 'i7' })]), [prompt('7'), reply]).sent).toEqual(new Set());
    expect(onShow(view([m('a', 'delivered', { item: 'i7' })]), [prompt('7')]).sent).toEqual(new Set());
    expect(onShow(view([m('a', 'landed', { item: 'i9' })]), [prompt('7')]).sent).toEqual(new Set());
    const answered = view([m('a', 'landed', { item: 'i8' })], { items: [{ k: 'text', text: 'ok', itemId: 'i8', pos: 8, conv: 'c1' }] });
    expect(onShow(answered, [prompt('7'), reply]).sent).toEqual(new Set());
  });

  it('shows after the conversation, oldest first, what is on its way and not in the queue tray', () => {
    const messages = [m('late', 'delivered', { sentAt: 3000 }), m('early', 'delivering', { sentAt: 2000 }), m('mac', 'queued'), m('done', 'landed'), m('back', 'taken')];
    expect(onShow(view(messages), []).bubbles.map((b) => b.id)).toEqual(['early', 'late']);
  });

  it('shows a message being sent only while it is not going into a queue', () => {
    expect(onShow(view([m('a', 'sending')]), []).bubbles.map((b) => b.id)).toEqual(['a']);
    expect(onShow(view([m('a', 'sending')], { status: 'working' }), []).bubbles).toEqual([]);
  });

  it('shows one the transcript lacks until a later prompt is in it', () => {
    const lost = m('a', 'unconfirmed', { sentAt: Date.parse('2026-10-08T10:00:00Z') });
    expect(onShow(view([lost]), [prompt('7', '2026-10-08T09:59:00Z')]).bubbles).toEqual([lost]);
    expect(onShow(view([lost]), [prompt('7')]).bubbles).toEqual([lost]);
    expect(onShow(view([lost]), [prompt('7', '2026-10-08T10:01:00Z'), reply]).bubbles).toEqual([]);
  });
});

describe('chatPending', () => {
  const held = { items: [{ itemId: 'i1', pos: 0, conv: 'c', kind: 'text', text: 'hi' } as never] };
  it.each<{ when: string; v: Partial<SessionView>; ended?: boolean; waits: boolean }>([
    { when: 'nothing is held yet', v: {}, waits: true },
    { when: 'the copy held is known to be behind the Mac', v: { ...held, behind: true }, waits: true },
    { when: 'only a message sent from here is held and the copy is behind', v: { messages: [{ id: 'm1', state: 'sending' } as never], behind: true }, waits: true },
    { when: 'the copy held is not known to be behind', v: held, waits: false },
    { when: 'only a message sent from here is held and the copy is not behind', v: { messages: [{ id: 'm1', state: 'sending' } as never] }, waits: false },
    { when: 'the Mac has answered', v: { ...held, synced: true, behind: true }, waits: false },
    { when: 'the Mac is not answering', v: { ...held, failed: true, behind: true }, waits: false },
    { when: 'the session has ended', v: { behind: true }, ended: true, waits: false },
  ])('waits on the Mac: $waits when $when', ({ v, ended = false, waits }) => {
    expect(chatPending({ ...emptyView, ...v }, ended)).toBe(waits);
  });
});
