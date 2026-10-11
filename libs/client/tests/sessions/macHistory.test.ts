import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@workoffdesk/i18n';
import { ApiError, type RecentConversation } from '../../src/base/api';
import { byDay, createMacHistory, HISTORY_PAGE, SEARCH_WAIT_MS } from '../../src/sessions/macHistory';
import { fakeApi } from '../helpers/fakes';

const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo, d, h).getTime();
const NOW = at(2026, 9, 11, 15);
const r = (sessionId: string, lastActivity: number): RecentConversation => ({
  sessionId,
  cwd: '/p',
  title: sessionId,
  lastActivity,
  automated: false,
  openIn: null,
  background: false,
});
const page = (rows: RecentConversation[], more = false) => ({ conversations: rows, more });
const ask = (q = '', before?: number) =>
  `GET /api/conversations?${new URLSearchParams({ ...(q ? { q } : {}), ...(before !== undefined ? { before: String(before) } : {}), limit: String(HISTORY_PAGE) })}`;

describe('byDay', () => {
  it('groups rows, newest first as they come, under Today, Yesterday and then the date', () => {
    const days = byDay([r('a', at(2026, 9, 11, 9)), r('b', at(2026, 9, 11, 1)), r('c', at(2026, 9, 10)), r('d', at(2026, 9, 2)), r('e', at(2025, 11, 30))], NOW);
    expect(days.map((d) => [d.title, d.rows.map((x) => x.sessionId)])).toEqual([
      [t.today, ['a', 'b']],
      [t.yesterday, ['c']],
      [new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(at(2026, 9, 2)), ['d']],
      [new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(at(2025, 11, 30)), ['e']],
    ]);
  });
});

describe('createMacHistory', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks for the newest page at once, and is loading until it comes', async () => {
    const { api, answer } = fakeApi();
    const h = createMacHistory(api);
    h.reload();
    expect(h.getSnapshot()).toMatchObject({ rows: [], loading: true, more: false, error: null });
    await answer(ask(), page([r('a', 5), r('b', 3)], true));
    expect(h.getSnapshot()).toMatchObject({ loading: false, more: true });
    expect(h.getSnapshot().rows.map((x) => x.sessionId)).toEqual(['a', 'b']);
  });

  it('asks for the next page from the last row shown, ties included, and shows each row once', async () => {
    const { api, answer, waiting } = fakeApi();
    const h = createMacHistory(api);
    h.reload();
    await answer(ask(), page([r('a', 5), r('b', 3)], true));
    h.loadMore();
    h.loadMore();
    expect(waiting()).toEqual([ask('', 4)]);
    await answer(ask('', 4), page([r('b', 3), r('c', 3), r('d', 1)], false));
    expect(h.getSnapshot().rows.map((x) => x.sessionId)).toEqual(['a', 'b', 'c', 'd']);
    expect(h.getSnapshot().more).toBe(false);
    h.loadMore();
    expect(waiting()).toEqual([]);
  });

  it('stops asking when a page brings nothing new, so it cannot ask forever', async () => {
    const { api, answer, waiting } = fakeApi();
    const h = createMacHistory(api);
    h.reload();
    await answer(ask(), page([r('a', 5)], true));
    h.loadMore();
    await answer(ask('', 6), page([r('a', 5)], true));
    expect(h.getSnapshot().more).toBe(false);
    h.loadMore();
    expect(waiting()).toEqual([]);
  });

  it('searches once typing pauses, from the first page, and shows only the latest search', async () => {
    const { api, answer, waiting } = fakeApi();
    const h = createMacHistory(api);
    h.reload();
    await answer(ask(), page([r('a', 5)], true));
    h.search('lo');
    h.search('log');
    expect(waiting()).toEqual([]);
    vi.advanceTimersByTime(SEARCH_WAIT_MS);
    expect(waiting()).toEqual([ask('log')]);
    expect(h.getSnapshot()).toMatchObject({ q: 'log', loading: true });
    h.search('login');
    vi.advanceTimersByTime(SEARCH_WAIT_MS);
    await answer(ask('login'), page([r('z', 9)]));
    await answer(ask('log'), page([r('y', 9)]));
    expect(h.getSnapshot().rows.map((x) => x.sessionId)).toEqual(['z']);
  });

  it('does not say an older search failed once a newer one has answered', async () => {
    const { api, answer, fail } = fakeApi();
    const h = createMacHistory(api);
    h.reload();
    h.search('log');
    vi.advanceTimersByTime(SEARCH_WAIT_MS);
    await answer(ask('log'), page([r('z', 9)]));
    await fail(ask(), new ApiError(500, ''));
    expect(h.getSnapshot()).toMatchObject({ error: null, loading: false });
    expect(h.getSnapshot().rows.map((x) => x.sessionId)).toEqual(['z']);
  });

  it('says why when the Mac does not answer, keeps what it shows, and asks again on reload', async () => {
    const { api, answer, fail } = fakeApi();
    const h = createMacHistory(api);
    h.reload();
    await answer(ask(), page([r('a', 5)], true));
    h.loadMore();
    await fail(ask('', 6), new ApiError(500, ''));
    expect(h.getSnapshot()).toMatchObject({ loading: false, error: t.loadFailed, more: true });
    expect(h.getSnapshot().rows.map((x) => x.sessionId)).toEqual(['a']);
    h.reload();
    expect(h.getSnapshot().error).toBeNull();
    await answer(ask(), page([r('b', 7)]));
    expect(h.getSnapshot().rows.map((x) => x.sessionId)).toEqual(['b']);
  });

  it('asks when held, and once let go takes no late answer and no typed search', async () => {
    const { api, answer, waiting } = fakeApi();
    const h = createMacHistory(api);
    const heard = vi.fn();
    h.subscribe(heard);
    const release = h.hold();
    expect(waiting()).toEqual([ask()]);
    h.search('x');
    release();
    vi.advanceTimersByTime(SEARCH_WAIT_MS);
    expect(waiting()).toEqual([ask()]);
    const told = heard.mock.calls.length;
    await answer(ask(), page([r('a', 5)]));
    expect(heard).toHaveBeenCalledTimes(told);
    // Held again, as a screen shown twice over is, it asks again and is heard.
    h.hold();
    await answer(ask('x'), page([r('b', 5)]));
    expect(h.getSnapshot().rows.map((x) => x.sessionId)).toEqual(['b']);
  });

  it('tells subscribers of each change, and nothing after they leave', async () => {
    const { api, answer } = fakeApi();
    const h = createMacHistory(api);
    const heard = vi.fn();
    const off = h.subscribe(heard);
    h.reload();
    await answer(ask(), page([]));
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    h.reload();
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
