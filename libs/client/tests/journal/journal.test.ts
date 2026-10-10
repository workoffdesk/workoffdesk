import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/base/api';
import { emptyView } from '../../src/journal/journalRows';
import { journalHeads, onHaveJournal, pushed, type JournalAt } from '../../src/journal/pushes';
import { flush } from '../helpers/fakes';
import { ask, following, item, memoryStore, message, setup, state, sync } from '../helpers/journal';

// A device's copy of a session's journal on the Mac, kept up to date by asking and by what the Mac pushes,
// and the messages sent from here, kept until the Mac has them.
beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  journalHeads(null);
});

describe('createJournals', () => {
  describe('the view', () => {
    it("is the conversation's turns in order and what the Mac says of it", async () => {
      const asks = [{ id: 'a1' }];
      const { view } = await following([
        item('i3', 3),
        item('i1', 1),
        item('x1', 2, 'c0'),
        state('conv', { conv: 'c1' }),
        state('status', 'working'),
        state('workingSince', 1234),
        state('screen', { choices: null, panel: null, mode: 'plan' }),
        state('asks', asks),
        state('live', { text: 'Thinking' }),
        state('tasks', [{ subject: 'Fix', status: 'in_progress' }]),
        state('background', [{ id: 'b1', label: 'npm test' }]),
        state('onMac', 2),
        message({ id: 'q1' }),
      ]);
      const v = view();
      expect(v.items.map((i) => i.itemId)).toEqual(['i1', 'i3']);
      expect(v).toMatchObject({
        synced: true,
        conv: 'c1',
        status: 'working',
        workingSince: 1234,
        screen: { choices: null, panel: null, mode: 'plan', asks },
        screenStale: false,
        live: 'Thinking',
        tasks: [{ subject: 'Fix', status: 'in_progress' }],
        background: [{ id: 'b1', label: 'npm test' }],
        onMac: 2,
        older: false,
      });
      expect(v.messages.map((m) => m.id)).toEqual(['q1']);
    });

    it('is empty and not synced until the Mac says', () => {
      const { journals, id, view } = setup();
      journals.follow(id);
      expect(view()).toStrictEqual(emptyView);
    });

    it('stays the same object until something in it changes', async () => {
      const { view, journals, id } = await following();
      const was = view();
      expect(view()).toBe(was);
      journals.apply(id, [state('status', 'idle')]);
      expect(view()).not.toBe(was);
    });

    it('tells listeners each time it changes, until they stop', async () => {
      const { journals, id } = await following();
      let told = 0;
      const stop = journals.subscribe(id, () => told++);
      journals.apply(id, [state('status', 'idle')]);
      stop();
      journals.apply(id, [state('status', 'working', 2)]);
      expect(told).toBe(1);
    });
  });

  describe('following a session', () => {
    it('asks the Mac for what the copy misses, page after page, and says where the copy is then', async () => {
      const { api, journals, id, view } = setup();
      const at: JournalAt[] = [];
      const unhear = onHaveJournal(id, (a) => at.push(a));
      journals.follow(id);
      await flush();
      await api.answer(ask(id), sync(3, [state('status', 'idle')], { more: true }));
      expect(view().synced).toBe(false);
      expect(at).toEqual([]);
      await api.answer(ask(id, 'e1', 3), sync(5, [state('status', 'working', 4)]));
      expect(view()).toMatchObject({ synced: true, status: 'working' });
      expect(at).toEqual([{ epoch: 'e1', v: 5 }]);
      unhear();
    });

    it('asks again from where the copy is while the Mac pushes nothing', async () => {
      const { api, id } = await following([], 3);
      expect(api.waiting()).toEqual([]);
      vi.advanceTimersByTime(1199);
      expect(api.waiting()).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(api.waiting()).toEqual([ask(id, 'e1', 3)]);
    });

    it('asks seldom while the Mac is pushing, and as before once it goes quiet', async () => {
      const { api, id } = await following([], 3);
      pushed(id, { type: 'alive' });
      vi.advanceTimersByTime(5000);
      expect(api.waiting()).toEqual([]);
      vi.advanceTimersByTime(10_000 + 1200 - 5000);
      expect(api.waiting()).toEqual([ask(id, 'e1', 3)]);
    });

    it('asks once more right after when asked to while it was asking', async () => {
      const { api, journals, id } = setup();
      journals.follow(id);
      await flush();
      journals.refresh(id);
      expect(api.waiting()).toEqual([ask(id)]);
      await api.answer(ask(id), sync(3));
      expect(api.waiting()).toEqual([ask(id, 'e1', 3)]);
    });

    it('does not ask while the page is hidden, and asks once it is shown', async () => {
      const { api, journals, id, visibility } = setup({ visible: false });
      journals.follow(id);
      await flush();
      vi.advanceTimersByTime(5000);
      expect(api.waiting()).toEqual([]);
      visibility.set(true);
      expect(api.waiting()).toEqual([ask(id)]);
    });

    it.each([
      [9999, false],
      [10_000, true],
    ])('shows that the Mac is not answering after reads fail for %s ms: %s', async (ms, failed) => {
      const { api, journals, id, view } = setup();
      journals.follow(id);
      await flush();
      await api.fail(ask(id), new ApiError(502, 'down'));
      vi.advanceTimersByTime(ms);
      await api.fail(ask(id), new Error('offline'));
      expect(view().failed).toBe(failed);
    });

    it('shows the Mac answering again once a read gets through', async () => {
      const { api, journals, id, view } = setup();
      journals.follow(id);
      await flush();
      await api.fail(ask(id), new Error('offline'));
      vi.advanceTimersByTime(10_000);
      await api.fail(ask(id), new Error('offline'));
      expect(view().failed).toBe(true);
      vi.advanceTimersByTime(1200);
      await api.answer(ask(id), sync(3));
      expect(view()).toMatchObject({ failed: false, synced: true });
    });

    it('counts the 10 seconds afresh from the next failure once a read gets through', async () => {
      const { api, journals, id, view } = setup();
      journals.follow(id);
      await flush();
      await api.fail(ask(id), new Error('offline'));
      vi.advanceTimersByTime(9000);
      await api.answer(ask(id), sync(3));
      vi.advanceTimersByTime(1200);
      await api.fail(ask(id, 'e1', 3), new Error('offline'));
      expect(view().failed).toBe(false);
    });

    it('asks nothing more after a read under way when it stopped', async () => {
      const { api, journals, id } = setup();
      const stop = journals.follow(id);
      await flush();
      stop();
      await api.answer(ask(id), sync(3));
      vi.advanceTimersByTime(60_000);
      expect(api.waiting()).toEqual([]);
    });

    it('stops asking once the Mac has no such session', async () => {
      const { api, journals, id, view } = setup();
      journals.follow(id);
      await flush();
      await api.fail(ask(id), new ApiError(404, 'no such session'));
      expect(view()).toMatchObject({ gone: true, failed: false });
      vi.advanceTimersByTime(60_000);
      expect(api.waiting()).toEqual([]);
    });

    it('asks nothing more once stopped and no longer says where the copy is', async () => {
      const { api, journals, id, stop, visibility } = await following([], 3);
      stop();
      vi.advanceTimersByTime(60_000);
      visibility.set(false);
      visibility.set(true);
      journals.refresh(id);
      expect(api.waiting()).toEqual([]);
      const at: JournalAt[] = [];
      onHaveJournal(id, (a) => at.push(a))();
      expect(at).toEqual([]);
    });
  });

  describe('pushes from the Mac', () => {
    it('go into the copy when they follow on from where it is', async () => {
      const { api, id, view } = await following([], 3);
      pushed(id, { type: 'journal', from: 3, v: 4, rows: [state('status', 'working', 4)] });
      expect(view().status).toBe('working');
      pushed(id, { type: 'journal', from: 4, v: 5, epoch: 'e1', rows: [state('status', 'idle', 5)] });
      expect(view().status).toBe('idle');
      expect(api.waiting()).toEqual([]);
    });

    it.each<[string, { from: number; epoch?: string }]>([
      ['it skips rows the copy has not had', { from: 4 }],
      ['it is of another epoch', { from: 3, epoch: 'e2' }],
    ])('are asked for again when %s', async (_, p) => {
      const { api, id, view } = await following([], 3);
      pushed(id, { type: 'journal', v: 9, rows: [state('status', 'working', 9)], ...p });
      expect(view().status).toBeNull();
      expect(api.waiting()).toEqual([ask(id, 'e1', 3)]);
    });

    it('start the copy over on a reset, keeping what is still being sent', async () => {
      const { journals, id, view } = await following([item('i1', 1), state('conv', { conv: 'c1' })], 3);
      void journals.send(id, 'still going');
      pushed(id, { type: 'journal', from: 0, v: 2, epoch: 'e2', reset: true, older: 7, rows: [item('i2', 2, 'c2'), state('conv', { conv: 'c2' })] });
      expect(view()).toMatchObject({ synced: true, conv: 'c2', older: true });
      expect(view().items.map((i) => i.itemId)).toEqual(['i2']);
      expect(view().messages.map((m) => m.text)).toEqual(['still going']);
    });

    it('leave the copy synced when they start it over before the Mac answered an ask', async () => {
      const { journals, id, view } = setup();
      journals.follow(id);
      await flush();
      pushed(id, { type: 'journal', from: 0, v: 2, epoch: 'e1', reset: true, rows: [state('status', 'idle', 2)] });
      expect(view()).toMatchObject({ synced: true, status: 'idle' });
    });

    it('are not the journal when they are the screen', async () => {
      const { api, id, view } = await following([], 3);
      const was = view();
      pushed(id, { type: 'screen', screen: { choices: null, panel: null } });
      expect(view()).toBe(was);
      expect(api.waiting()).toEqual([]);
    });
  });

  describe('journal heads from the list socket', () => {
    it('mark the copy behind until it catches up, and synced once it has', async () => {
      const { api, journals, id, view } = setup();
      journals.follow(id);
      await flush();
      journalHeads({ epoch: 'e1', heads: { [id]: 5 } });
      await api.answer(ask(id), sync(3, [], { more: true }));
      expect(view()).toMatchObject({ behind: true, synced: false });
      pushed(id, { type: 'journal', from: 3, v: 5, rows: [] });
      expect(view()).toMatchObject({ behind: false, synced: true });
    });

    it('mark the copy behind as soon as the socket says the Mac moved', async () => {
      const { id, view } = await following([], 3);
      journalHeads({ epoch: 'e1', heads: { [id]: 4 } });
      expect(view().behind).toBe(true);
      journalHeads({ epoch: 'e2', heads: { [id]: 3 } });
      expect(view().behind).toBe(true);
      journalHeads(null);
      expect(view().behind).toBe(false);
    });
  });

  describe('the copy kept on the device', () => {
    const kept = { epoch: 'e1', v: 3, older: 7, rows: [item('i1', 1), state('conv', { conv: 'c1' })] };

    it('shows before the Mac answers, and only what follows it is asked for', async () => {
      const { store } = memoryStore(kept);
      const { api, journals, id, view } = setup({ store });
      journals.follow(id);
      await flush();
      expect(view()).toMatchObject({ synced: false, older: true });
      expect(view().items.map((i) => i.itemId)).toEqual(['i1']);
      expect(api.waiting()).toEqual([ask(id, 'e1', 3)]);
    });

    it('is synced from the start when the socket says the Mac is where it is', async () => {
      const { store } = memoryStore(kept);
      const { journals, id, view } = setup({ store });
      journalHeads({ epoch: 'e1', heads: { [id]: 3 } });
      journals.follow(id);
      await flush();
      expect(view().synced).toBe(true);
    });

    it('tells the Mac where the copy is before the Mac answers', async () => {
      const { store } = memoryStore(kept);
      const { journals, id } = setup({ store });
      const at: JournalAt[] = [];
      const unhear = onHaveJournal(id, (a) => at.push(a));
      journals.follow(id);
      await flush();
      expect(at).toEqual([{ epoch: 'e1', v: 3 }]);
      unhear();
    });

    it('is synced by the last page of a catch-up the Mac pushes', async () => {
      const { store } = memoryStore(kept);
      const { journals, id, view } = setup({ store });
      journals.follow(id);
      await flush();
      pushed(id, { type: 'journal', from: 3, v: 4, epoch: 'e1', more: true, rows: [] });
      expect(view().synced).toBe(false);
      pushed(id, { type: 'journal', from: 4, v: 5, epoch: 'e1', rows: [] });
      expect(view().synced).toBe(true);
    });

    it('is written with each answer and each reset', async () => {
      const { store, did } = memoryStore();
      const { api, journals, id } = setup({ store });
      journals.follow(id);
      await flush();
      await api.answer(ask(id), sync(3, [item('i1', 1)], { reset: true, older: 9 }));
      pushed(id, { type: 'journal', from: 3, v: 4, rows: [state('status', 'idle', 4)] });
      expect(did).toEqual(['write e1 3 9 i1 reset', 'write e1 4 9 status']);
    });

    it('is started without when it cannot be read', async () => {
      const { store } = memoryStore();
      store.load = () => Promise.reject(new Error('locked'));
      const { api, journals, id } = setup({ store });
      journals.follow(id);
      await flush();
      expect(api.waiting()).toEqual([ask(id)]);
    });

    it('is neither shown nor asked for once the page stopped following before it was read', async () => {
      const { store } = memoryStore(kept);
      const { api, journals, id, view } = setup({ store });
      journals.follow(id)();
      await flush();
      expect(view().items).toEqual([]);
      expect(api.waiting()).toEqual([]);
    });
  });
});
