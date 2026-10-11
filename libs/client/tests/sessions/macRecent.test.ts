import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecentConversation } from '../../src/base/api';
import { followMacRecent, keptMacRecent, MAC_KEY, MAC_RECENT_MS, MAC_SHOWN, macShown, notGoneOnHere } from '../../src/sessions/macRecent';
import { aSession, brokenStorage, fakeVisibility, memoryStorage } from '../helpers/fakes';

const NOW = Date.UTC(2026, 9, 5, 12);
const r = (over: Partial<RecentConversation> = {}): RecentConversation => ({
  sessionId: 'c1',
  cwd: '/p',
  title: 'T',
  lastActivity: NOW - 1000,
  automated: false,
  openIn: null,
  background: false,
  ...over,
});

describe('macShown', () => {
  it('keeps the Mac list under workoffdesk.mac-sessions', () => {
    expect(MAC_KEY).toBe('workoffdesk.mac-sessions');
  });

  it('shows what a person had going lately in a folder, not what is open elsewhere or run by a program', () => {
    const all = [
      r({ sessionId: 'ok' }),
      r({ sessionId: 'auto', automated: true }),
      r({ sessionId: 'open', openIn: 'iTerm' }),
      r({ sessionId: 'nocwd', cwd: null }),
      r({ sessionId: 'old', lastActivity: NOW - MAC_RECENT_MS - 1 }),
    ];
    expect(macShown(all, NOW).map((x) => x.sessionId)).toEqual(['ok']);
  });

  // The session here shows the moment it starts; the Mac's list says it is open here only once asked again.
  it('leaves out a conversation a session here goes on with, before the Mac says so', () => {
    const all = [r({ sessionId: 'claude' }), r({ sessionId: 'thread' }), r({ sessionId: 'ended' }), r({ sessionId: 'ok' })];
    const here = [aSession({ claudeSessionId: 'claude' }), aSession({ codexThreadId: 'thread' }), aSession({ claudeSessionId: 'ended', past: true })];
    expect(macShown(all, NOW, here).map((x) => x.sessionId)).toEqual(['ended', 'ok']);
    expect(notGoneOnHere(all, here).map((x) => x.sessionId)).toEqual(['ended', 'ok']);
  });

  it('shows at most MAC_SHOWN, in the order the Mac gave', () => {
    const all = Array.from({ length: MAC_SHOWN + 5 }, (_, i) => r({ sessionId: `s${i}` }));
    const shown = macShown(all, NOW);
    expect(shown).toHaveLength(MAC_SHOWN);
    expect(shown[0].sessionId).toBe('s0');
  });
});

describe('followMacRecent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(kept?: RecentConversation[]) {
    const storage = memoryStorage(kept ? { [MAC_KEY]: JSON.stringify(kept) } : {});
    const visibility = fakeVisibility();
    const answers: ((v: RecentConversation[] | Error) => void)[] = [];
    const api = vi.fn(
      () =>
        new Promise<RecentConversation[]>((ok, fail) => answers.push((v) => (v instanceof Error ? fail(v) : ok(v)))),
    ) as unknown as Parameters<typeof followMacRecent>[0]['api'];
    const shown: RecentConversation[][] = [];
    const stop = followMacRecent({ api, storage, visibility }, (list) => shown.push(list));
    return { storage, visibility, answers, api: api as unknown as ReturnType<typeof vi.fn>, shown, stop };
  }

  it('shows what was kept at once, then what the Mac says, and keeps that', async () => {
    const s = setup([r({ sessionId: 'kept' })]);
    expect(s.shown[0].map((x) => x.sessionId)).toEqual(['kept']);
    s.answers[0]([r({ sessionId: 'fresh' })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.shown.at(-1)!.map((x) => x.sessionId)).toEqual(['fresh']);
    expect(JSON.parse(s.storage.data.get(MAC_KEY)!)[0].sessionId).toBe('fresh');
    expect(s.api).toHaveBeenCalledWith('/api/recent');
  });

  it('asks again after a failure, waiting twice as long each time up to 30 s', async () => {
    const s = setup();
    const at: number[] = [];
    for (let i = 0; i < 7; i++) {
      s.answers[i](new Error('down'));
      const start = Date.now();
      while (s.answers.length === i + 1) await vi.advanceTimersByTimeAsync(100);
      at.push(Date.now() - start);
    }
    expect(at).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('asks again when the app comes back to the front', async () => {
    const s = setup();
    s.answers[0]([]);
    await vi.advanceTimersByTimeAsync(0);
    s.visibility.set(false);
    expect(s.answers).toHaveLength(1);
    s.visibility.set(true);
    expect(s.answers).toHaveLength(2);
  });

  it('stops asking and showing once stopped', async () => {
    const s = setup();
    s.stop();
    s.answers[0](new Error('down'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.answers).toHaveLength(1);
    expect(s.shown).toEqual([[]]);
    s.visibility.set(true);
    expect(s.answers).toHaveLength(1);
  });

  it('works without a store', async () => {
    const answers: ((v: RecentConversation[]) => void)[] = [];
    const shown: RecentConversation[][] = [];
    const api = (() => new Promise<RecentConversation[]>((ok) => answers.push(ok))) as unknown as Parameters<typeof followMacRecent>[0]['api'];
    followMacRecent({ api, storage: brokenStorage, visibility: fakeVisibility() }, (l) => shown.push(l));
    answers[0]([r()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(shown.at(-1)).toHaveLength(1);
  });
});

describe('keptMacRecent', () => {
  it('reads what was kept, and nothing from a broken or garbled store', () => {
    expect(keptMacRecent(memoryStorage({ [MAC_KEY]: JSON.stringify([r()]) }))).toEqual([r()]);
    expect(keptMacRecent(memoryStorage({ [MAC_KEY]: '{"not":"a list"}' }))).toEqual([]);
    expect(keptMacRecent(brokenStorage)).toEqual([]);
  });
});
