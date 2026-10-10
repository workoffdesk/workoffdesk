import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/base/api';
import { createChatFeeds } from '../../src/chat/chatFeed';
import type { ChatItem, ChatRead, ChatState } from '../../src/model/chat';
import { fakeVisibility } from '../helpers/fakes';

const say = (text: string): ChatItem => ({ k: 'text', text });
const read = (from: number, next: number, items: ChatItem[] = [], sid = 'x'): ChatRead => ({ sid, items, from, next, skipped: false });

// The Mac as the feed sees it: each request waits for the test to answer it.
function fakeMac() {
  const asked: { path: string; answer: (v: unknown) => void; fail: (e: unknown) => void }[] = [];
  const api = <T>(path: string) =>
    new Promise<T>((answer, fail) => asked.push({ path, answer: answer as (v: unknown) => void, fail }));
  return { api, asked, last: () => asked.at(-1)! };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let sid = 0;
function setup(o: { kept?: ChatState | null } = {}) {
  const mac = fakeMac();
  const visibility = fakeVisibility();
  const keep = vi.fn();
  const feeds = createChatFeeds({
    api: mac.api as never,
    store: { kept: async () => o.kept ?? null, keep },
  });
  const sessionId = `s${++sid}`;
  const shown: ChatState[] = [];
  const failed: boolean[] = [];
  const loadingOlder: boolean[] = [];
  const url = `/api/claude/sessions/${sessionId}/chat`;
  const follow = (page = visibility) =>
    feeds.follow(sessionId, url, { show: (c) => shown.push(c), failed: (f) => failed.push(f), loadingOlder: (b) => loadingOlder.push(b) }, page);
  return { mac, visibility, keep, feeds, sessionId, url, shown, failed, loadingOlder, follow };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createChatFeeds', () => {
  it('shows the copy kept on the device first, without keeping it again, then reads on from it', async () => {
    const kept: ChatState = { sid: 'x', items: [say('old')], next: 50, base: 0, pages: [{ start: 0, count: 1 }] };
    const { mac, shown, keep, follow, url } = setup({ kept });
    follow();
    await flush();
    expect(shown).toEqual([kept]);
    expect(keep).not.toHaveBeenCalled();
    expect(mac.last().path).toBe(`${url}?from=50&sid=x`);
    mac.last().answer(read(50, 60, [say('new')]));
    await flush();
    expect(shown.at(-1)!.items.map((i) => (i as { text: string }).text)).toEqual(['old', 'new']);
    expect(keep).toHaveBeenCalledOnce();
  });

  it('starts from what this client showed last and skips a read that brought nothing new', async () => {
    const { mac, shown, follow, feeds, sessionId, url } = setup();
    const feed = follow();
    await flush();
    expect(mac.last().path).toBe(`${url}?from=0&sid=`);
    mac.last().answer(read(0, 10, [say('a')]));
    await flush();
    feed.stop();
    expect(feeds.remembered(sessionId)?.next).toBe(10);
    follow();
    await flush();
    expect(mac.last().path).toBe(`${url}?from=10&sid=x`);
    const before = shown.length;
    mac.last().answer(read(10, 10));
    await flush();
    expect(shown.length).toBe(before);
  });

  it('asks every 1.2 s', async () => {
    const { mac, follow } = setup();
    follow();
    await flush();
    mac.last().answer(read(0, 0));
    await flush();
    vi.advanceTimersByTime(1199);
    expect(mac.asked).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(mac.asked).toHaveLength(2);
  });

  it('does not read while the user is away, and reads at once when they are back', async () => {
    const { mac, follow, visibility } = setup();
    follow();
    await flush();
    mac.last().answer(read(0, 0));
    await flush();
    visibility.set(false);
    vi.advanceTimersByTime(10_000);
    await flush();
    expect(mac.asked).toHaveLength(1);
    visibility.set(true);
    expect(mac.asked).toHaveLength(2);
  });

  it('does not read while its page is behind another, and reads at once when the page comes back in front', async () => {
    const { mac, follow } = setup();
    const page = fakeVisibility(false);
    follow(page);
    await flush();
    vi.advanceTimersByTime(60_000);
    await flush();
    expect(mac.asked).toHaveLength(0);
    page.set(true);
    expect(mac.asked).toHaveLength(1);
  });

  it('reports it cannot read the chat only after 10 s of failing, and clears that on the next good read', async () => {
    const { mac, follow, failed } = setup();
    follow();
    await flush();
    for (let i = 0; i < 9; i++) {
      mac.last().fail(new TypeError('network'));
      await flush();
      vi.advanceTimersByTime(1200);
    }
    expect(failed).not.toContain(true);
    mac.last().fail(new TypeError('network'));
    await flush();
    expect(failed.at(-1)).toBe(true);
    vi.advanceTimersByTime(1200);
    mac.last().answer(read(0, 0));
    await flush();
    expect(failed.at(-1)).toBe(false);
  });

  it('stops reading once the Mac says the conversation is gone (404), never saying it is retrying', async () => {
    const { mac, follow, failed } = setup();
    follow();
    await flush();
    mac.last().fail(new ApiError(404, 'no such session'));
    await flush();
    vi.advanceTimersByTime(60_000);
    await flush();
    expect(mac.asked).toHaveLength(1);
    expect(failed).not.toContain(true);
  });

  it('clears the cannot-read note once the session turns out to be gone', async () => {
    const { mac, follow, failed } = setup();
    follow();
    await flush();
    for (let i = 0; i < 10; i++) {
      mac.last().fail(new TypeError('network'));
      await flush();
      vi.advanceTimersByTime(1200);
    }
    expect(failed.at(-1)).toBe(true);
    mac.last().fail(new ApiError(404, 'no such session'));
    await flush();
    expect(failed.at(-1)).toBe(false);
    const asked = mac.asked.length;
    vi.advanceTimersByTime(60_000);
    expect(mac.asked).toHaveLength(asked);
  });

  it('keeps reading through a failure that is not a 404', async () => {
    const { mac, follow } = setup();
    follow();
    await flush();
    mac.last().fail(new ApiError(500, ''));
    await flush();
    vi.advanceTimersByTime(1200);
    expect(mac.asked).toHaveLength(2);
  });

  it('stops asking once stopped, even with a read on its way', async () => {
    const { mac, follow, shown } = setup();
    const feed = follow();
    await flush();
    feed.stop();
    mac.last().answer(read(0, 5, [say('late')]));
    await flush();
    vi.advanceTimersByTime(60_000);
    expect(mac.asked).toHaveLength(1);
    expect(shown).toEqual([]);
  });

  it('puts earlier turns before the ones shown, a page at a time, telling the screen just before', async () => {
    const { mac, follow, shown, url, loadingOlder } = setup();
    const feed = follow();
    await flush();
    mac.last().answer(read(100, 120, [say('late')]));
    await flush();
    const beforeShow = vi.fn(() => expect(shown).toHaveLength(1));
    const first = feed.older(beforeShow);
    void feed.older(beforeShow);
    expect(mac.last().path).toBe(`${url}?sid=x&before=100`);
    expect(mac.asked).toHaveLength(2);
    mac.last().answer(read(0, 100, [say('early')]));
    await first;
    expect(beforeShow).toHaveBeenCalledOnce();
    expect(shown.at(-1)!.items.map((i) => (i as { text: string }).text)).toEqual(['early', 'late']);
    expect(loadingOlder).toEqual([true, false]);
    // Nothing before the first byte.
    await feed.older(beforeShow);
    expect(mac.asked).toHaveLength(2);
  });
});
