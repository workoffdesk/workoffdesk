import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/base/api';
import { emptyView, type JournalStore, type Message } from '../../src/journal/journalRows';
import { journalHeads, pushed } from '../../src/journal/pushes';
import { flush } from '../helpers/fakes';
import { ask, base, following, item, memoryStore, message, POST, setup, state, sync } from '../helpers/journal';

// Messages sent from here, kept until the Mac has them, and what happens to them after.
beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  journalHeads(null);
});

describe('createJournals', () => {
  describe('sending a message', () => {
    it('keeps it here as sending and posts it once under its own id', async () => {
      const { api, journals, id, view } = setup();
      void journals.send(id, 'run the tests');
      expect(view().messages).toEqual([{ id: 'q1', text: 'run the tests', sentAt: Date.now(), state: 'sending', ord: null, item: null }]);
      await flush();
      expect(api.init(POST(id))).toMatchObject({ method: 'POST', json: { text: 'run the tests', id: 'q1' }, idempotent: true });
    });

    it('takes what the Mac answers with', async () => {
      const { api, journals, id, view } = setup();
      const sent = journals.send(id, 'hi');
      await flush();
      await api.answer(POST(id), { message: message({ id: 'q1', state: 'queued', ord: 1 }, 6) });
      await sent;
      expect(view().messages).toMatchObject([{ id: 'q1', state: 'queued', ord: 1 }]);
    });

    it('waits until the one before reached the Mac, by its answer or by the journal', async () => {
      const { api, journals, id } = setup();
      void journals.send(id, 'one');
      void journals.send(id, 'two');
      void journals.send(id, 'three');
      await flush();
      expect(api.waiting()).toEqual([POST(id)]);
      await api.answer(POST(id), { message: null });
      expect(api.init(POST(id))?.json).toEqual({ text: 'two', id: 'q2' });
      journals.apply(id, [message({ id: 'q2' }, 7)]);
      await flush();
      expect(api.waiting()).toEqual([POST(id), POST(id)]);
    });

    it('lets the next one go when one fails', async () => {
      const { api, journals, id } = setup();
      const one = journals.send(id, 'one');
      void journals.send(id, 'two');
      await flush();
      await api.fail(POST(id), new ApiError(503, 'down'));
      await expect(one).rejects.toThrow('down');
      expect(api.init(POST(id))?.json).toEqual({ text: 'two', id: 'q2' });
    });

    it('gives it back, no longer kept, when the Mac turned it down or could not be reached', async () => {
      const { store, did } = memoryStore();
      const { api, journals, id, view } = setup({ store });
      const sent = journals.send(id, 'hi');
      await flush();
      await api.fail(POST(id), new ApiError(400, 'too long'));
      await expect(sent).rejects.toThrow('too long');
      expect(view().messages).toEqual([]);
      expect(did).toContain('remove q1');
    });

    it('counts it sent when the Mac said it had it before the answer failed', async () => {
      const { api, journals, id, view } = setup();
      const sent = journals.send(id, 'hi');
      await flush();
      journals.apply(id, [message({ id: 'q1', state: 'delivered' }, 5)]);
      await api.fail(POST(id), new Error('the tunnel blinked'));
      await expect(sent).resolves.toBeUndefined();
      expect(view().messages).toMatchObject([{ id: 'q1', state: 'delivered' }]);
    });
  });

  describe('a message still being sent when the app stopped', () => {
    const kept = (m: Partial<Message>) => ({ epoch: 'e1', v: 3, older: null, rows: [message({ id: 'q9', text: 'from before', state: 'sending', ...m }, 0)] });

    it('is sent again once the Mac has answered, only once however often it is asked', async () => {
      const { store } = memoryStore(kept({}));
      const { api, journals, id } = setup({ store });
      journals.follow(id);
      await flush();
      expect(api.waiting()).toEqual([ask(id, 'e1', 3)]);
      await api.answer(ask(id, 'e1', 3), sync(3));
      expect(api.init(POST(id))?.json).toEqual({ text: 'from before', id: 'q9' });
      vi.advanceTimersByTime(1200);
      await api.answer(ask(id, 'e1', 3), sync(3));
      expect(api.waiting().filter((c) => c === POST(id))).toHaveLength(1);
    });

    it('is not sent again when the Mac has had it since', async () => {
      const { store } = memoryStore(kept({}));
      const { api, journals, id } = setup({ store });
      journals.follow(id);
      await flush();
      await api.answer(ask(id, 'e1', 3), sync(4, [message({ id: 'q9', state: 'landed' }, 4)]));
      expect(api.waiting()).not.toContain(POST(id));
    });

    it('is not sent twice when it is already being sent', async () => {
      const { api, journals, id } = setup();
      void journals.send(id, 'now');
      journals.follow(id);
      await flush();
      await api.answer(ask(id), sync(3));
      await api.answer(POST(id), { message: null });
      expect(api.waiting()).not.toContain(POST(id));
    });

    it('is sent again only once while the page follows, though the Mac could not take it', async () => {
      const { store } = memoryStore(kept({}));
      const { api, journals, id } = setup({ store });
      journals.follow(id);
      await flush();
      await api.answer(ask(id, 'e1', 3), sync(3));
      await api.fail(POST(id), new ApiError(503, 'restarting'));
      vi.advanceTimersByTime(1200);
      await api.answer(ask(id, 'e1', 3), sync(3));
      expect(api.waiting()).not.toContain(POST(id));
    });

    it.each<[string, unknown, boolean]>([
      ['dropped when the Mac turns it down', new ApiError(422, 'no'), false],
      ['kept when the Mac could not take it now', new ApiError(503, 'restarting'), true],
      ['kept when the Mac could not be reached', new Error('offline'), true],
    ])('is %s', async (_, error, stays) => {
      const { store, did } = memoryStore(kept({}));
      const { api, journals, id, view } = setup({ store });
      journals.follow(id);
      await flush();
      await api.answer(ask(id, 'e1', 3), sync(3));
      await api.fail(POST(id), error);
      expect(view().messages.map((m) => m.id)).toEqual(stays ? ['q9'] : []);
      expect(did.includes('remove q9')).toBe(!stays);
    });
  });

  describe('a card pressed', () => {
    it('hides what the screen held until the screen is read again', async () => {
      const { api, journals, id, view } = await following([state('screen', { choices: null, panel: { title: 'Status', body: '', hint: '' } })], 3);
      journals.rereadScreen(id);
      expect(view()).toMatchObject({ screenStale: true, screen: { choices: null, panel: null } });
      expect(api.waiting()).toEqual([ask(id, 'e1', 3)]);
      await api.answer(ask(id, 'e1', 3), sync(3));
      expect(view().screenStale).toBe(false);
      expect(view().screen.panel?.title).toBe('Status');
    });

    it('shows the screen again as soon as the Mac pushes it', async () => {
      const { journals, id, view } = await following([], 3);
      journals.rereadScreen(id);
      pushed(id, { type: 'journal', from: 3, v: 4, rows: [state('asks', [], 4)] });
      expect(view().screenStale).toBe(false);
    });
  });

  describe('older turns', () => {
    const opened = async (store?: JournalStore) => {
      const t = setup({ store });
      t.journals.follow(t.id);
      await flush();
      await t.api.answer(ask(t.id), sync(3, [item('i5', 5), state('conv', { conv: 'c1' })], { reset: true, older: 5 }));
      return t;
    };
    const OLDER = (id: string) => `GET ${base(id)}/journal/items?conv=c1&before=5`;

    it('come a page at a time, and the page is told just before they show', async () => {
      const { api, journals, id, view } = await opened();
      let before: string[] = [];
      const done = journals.older(id, () => (before = view().items.map((i) => i.itemId)));
      expect(view().loadingOlder).toBe(true);
      void journals.older(id);
      expect(api.waiting()).toEqual([OLDER(id)]);
      await api.answer(OLDER(id), { rows: [item('i2', 2), item('i3', 3)], older: null });
      await done;
      expect(before).toEqual(['i5']);
      expect(view().items.map((i) => i.itemId)).toEqual(['i2', 'i3', 'i5']);
      expect(view()).toMatchObject({ older: false, loadingOlder: false });
    });

    it('are kept on the device with where the next page starts', async () => {
      const { store, did } = memoryStore();
      const { api, journals, id } = await opened(store);
      const done = journals.older(id);
      await api.answer(OLDER(id), { rows: [item('i2', 2)], older: 2 });
      await done;
      expect(did.at(-1)).toBe('write e1 3 2 i2');
    });

    it('are asked for again on the next try when a page fails', async () => {
      const { api, journals, id, view } = await opened();
      const done = journals.older(id);
      await api.fail(OLDER(id), new Error('offline'));
      await done;
      expect(view()).toMatchObject({ older: true, loadingOlder: false });
      void journals.older(id);
      expect(api.waiting()).toEqual([OLDER(id)]);
    });

    it('are left out when the session moved to another conversation meanwhile', async () => {
      const { api, journals, id, view } = await opened();
      const done = journals.older(id);
      journals.apply(id, [state('conv', { conv: 'c2' }, 9)]);
      await api.answer(OLDER(id), { rows: [item('i2', 2, 'c1')], older: null });
      await done;
      journals.apply(id, [state('conv', { conv: 'c1' }, 10)]);
      expect(view().items.map((i) => i.itemId)).toEqual(['i5']);
      expect(view().older).toBe(true);
    });

    it('are not asked for when there are none', async () => {
      const { api, journals, id } = await following([state('conv', { conv: 'c1' })], 3);
      await journals.older(id);
      expect(api.waiting()).toEqual([]);
    });

    it('are not asked for before the conversation is known', async () => {
      const { api, journals, id } = setup();
      journals.follow(id);
      await flush();
      await api.answer(ask(id), sync(3, [item('i5', 5)], { reset: true, older: 5 }));
      await journals.older(id);
      expect(api.waiting()).toEqual([]);
    });
  });

  describe('signing out', () => {
    it('forgets every copy, here and on the device', async () => {
      const { store, did } = memoryStore();
      const { journals, id, view } = setup({ store });
      journals.apply(id, [state('status', 'idle')]);
      await journals.forget();
      expect(view()).toStrictEqual(emptyView);
      expect(did.at(-1)).toBe('forget');
    });
  });
});
