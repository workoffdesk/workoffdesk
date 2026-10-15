import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caughtUp, journalHeads } from '../../src/journal/pushes';
import { createSessionList, SESSIONS_KEY } from '../../src/sessions/sessionList';
import { SLOW_MS, type Slow, type TermSession } from '../../src/base/api';
import { brokenStorage, fakeServer, fakeVisibility, memoryStorage, type FakeSocket } from '../helpers/fakes';

const session = (id: string): TermSession => ({
  id,
  title: id,
  kind: 'claude',
  cwd: '/p',
  createdAt: 0,
  lastActivity: 0,
  status: 'idle',
});
const listOf = (...ids: string[]) => ({ type: 'sessions', machine: 'local', sessions: ids.map(session) });

function setup(storage = memoryStorage(), ask?: () => Promise<unknown>, onSlow?: (slow: Slow) => void) {
  const server = fakeServer();
  const visibility = fakeVisibility();
  const onSignedOut = vi.fn();
  const list = createSessionList({ open: server.open, storage, visibility, onSignedOut, ask, onSlow });
  return { server, visibility, onSignedOut, list, storage };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  journalHeads(null);
});

describe('createSessionList', () => {
  it('starts from the list kept on the device, and from nothing when that is damaged', () => {
    const kept = memoryStorage({ [SESSIONS_KEY]: JSON.stringify([session('a')]) });
    expect(setup(kept).list.current()?.map((s) => s.id)).toEqual(['a']);
    expect(setup(memoryStorage({ [SESSIONS_KEY]: '{oops' })).list.current()).toBeNull();
    expect(setup(memoryStorage({ [SESSIONS_KEY]: '{"a":1}' })).list.current()).toBeNull();
    expect(setup(brokenStorage as never).list.current()).toBeNull();
  });

  it('keeps the session list under workoffdesk.sessions', () => {
    expect(SESSIONS_KEY).toBe('workoffdesk.sessions');
  });

  it('opens /api/events on the first subscriber and shows and keeps what the Mac sends', () => {
    const { server, list, storage } = setup();
    const heard = vi.fn();
    list.subscribe(heard);
    expect(server.sockets.map((s) => s.path)).toEqual(['/api/events']);
    list.subscribe(vi.fn());
    expect(server.sockets).toHaveLength(1);
    server.last().says(listOf('a', 'b'));
    expect(list.current()?.map((s) => s.id)).toEqual(['a', 'b']);
    expect(heard).toHaveBeenCalled();
    expect(JSON.parse(storage.data.get(SESSIONS_KEY)!)).toHaveLength(2);
  });

  it('ignores what is not the local list', () => {
    const { server, list } = setup();
    list.subscribe(vi.fn());
    server.last().says({ type: 'sessions', machine: 'other', sessions: [session('x')] });
    server.last().says({ type: 'hello' });
    expect(list.current()).toBeNull();
  });

  it('still shows the list when storage throws', () => {
    const { server, list } = setup(brokenStorage as never);
    list.subscribe(vi.fn());
    server.last().says(listOf('a'));
    expect(list.current()?.map((s) => s.id)).toEqual(['a']);
  });

  it.each([4401, 4403])('sends a socket closed with %i to the login and does not reconnect', (code) => {
    const { server, list, onSignedOut } = setup();
    list.subscribe(vi.fn());
    server.last().ends(code);
    expect(onSignedOut).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    expect(server.sockets).toHaveLength(1);
  });

  it('reconnects after 1 s, 2 s, 4 s … up to 30 s, back to 1 s once the Mac speaks', () => {
    const { server, list } = setup();
    list.subscribe(vi.fn());
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      const before = server.sockets.length;
      server.last().ends(1006);
      let waited = 0;
      while (server.sockets.length === before) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
    server.last().says(listOf('a'));
    server.last().ends(1006);
    vi.advanceTimersByTime(999);
    expect(server.sockets).toHaveLength(8);
    vi.advanceTimersByTime(1);
    expect(server.sockets).toHaveLength(9);
  });

  it('comes back within 250–750 ms when the server restarts (4012), then waits 500 ms after a failure', () => {
    const { server, list } = setup();
    list.subscribe(vi.fn());
    server.last().ends(4012);
    vi.advanceTimersByTime(249);
    expect(server.sockets).toHaveLength(1);
    vi.advanceTimersByTime(501);
    expect(server.sockets).toHaveLength(2);
    server.last().ends(1006);
    vi.advanceTimersByTime(499);
    expect(server.sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(server.sockets).toHaveLength(3);
  });

  it('asks afresh when the user comes back, without the old socket starting a second reconnect', () => {
    const { server, list, visibility } = setup();
    list.subscribe(vi.fn());
    const first = server.last();
    visibility.set(false);
    expect(server.sockets).toHaveLength(1);
    visibility.set(true);
    expect(first.closed).toBe(true);
    expect(server.sockets).toHaveLength(2);
    first.ends(1006);
    vi.advanceTimersByTime(60_000);
    expect(server.sockets).toHaveLength(2);
  });

  it('keeps the socket 5 s after the last subscriber leaves, so moving between pages does not drop it', () => {
    const { server, list, visibility } = setup();
    const off = list.subscribe(vi.fn());
    off();
    vi.advanceTimersByTime(4999);
    const back = list.subscribe(vi.fn());
    expect(server.sockets).toHaveLength(1);
    expect(server.last().closed).toBe(false);
    back();
    vi.advanceTimersByTime(5000);
    expect(server.last().closed).toBe(true);
    expect(visibility.listeners.size).toBe(0);
    server.last().ends(1006);
    vi.advanceTimersByTime(60_000);
    expect(server.sockets).toHaveLength(1);
  });

  it('drops a deleted session at once and keeps the shorter list', () => {
    const { server, list, storage } = setup();
    list.subscribe(vi.fn());
    server.last().says(listOf('a', 'b'));
    list.drop('a');
    expect(list.current()?.map((s) => s.id)).toEqual(['b']);
    expect(JSON.parse(storage.data.get(SESSIONS_KEY)!).map((s: TermSession) => s.id)).toEqual(['b']);
  });

  it.each(['claude', 'codex'] as const)('keeps a %s session ended here at once as past, ended and without usage, as the Mac will', (kind) => {
    const { server, list } = setup();
    list.subscribe(vi.fn());
    server.last().says({ type: 'sessions', machine: 'local', sessions: [{ ...session('a'), kind, usage: { tokens: 5 } }, session('b')] });
    list.ends('a');
    expect(list.current()?.map((s) => s.id)).toEqual(['a', 'b']);
    expect(list.current()?.[0]).toMatchObject({ id: 'a', past: true, status: 'ended', usage: null });
    expect(list.current()?.[1].past).toBeUndefined();
  });

  describe('a name given here', () => {
    const titles = (list: ReturnType<typeof setup>['list']) => list.current()?.map((s) => s.title);
    const named = (...titles: string[]) => ({ ...listOf(), sessions: titles.map((title, i) => ({ ...session(['a', 'b'][i]), title })) });

    it('shows at once, over lists the Mac read before it took it, and not on another session', () => {
      const { server, list, storage } = setup();
      list.subscribe(vi.fn());
      server.last().says(listOf('a', 'b'));
      list.naming('a', 'Fix the login');
      expect(titles(list)).toEqual(['Fix the login', 'b']);
      server.last().says(listOf('a', 'b'));
      expect(titles(list)).toEqual(['Fix the login', 'b']);
      // What is kept on the device is what the Mac said.
      expect(JSON.parse(storage.data.get(SESSIONS_KEY)!).map((s: TermSession) => s.title)).toEqual(['a', 'b']);
    });

    it('gives way to the Mac once a list has it, so a later name from the Mac shows', () => {
      const { server, list } = setup();
      list.subscribe(vi.fn());
      server.last().says(listOf('a', 'b'));
      list.naming('a', 'Fix the login');
      server.last().says(named('Fix the login', 'b'));
      server.last().says(named('Named at the Mac', 'b'));
      expect(titles(list)).toEqual(['Named at the Mac', 'b']);
    });

    it('is taken back with null, showing what the Mac said', () => {
      const { server, list } = setup();
      const heard = vi.fn();
      list.subscribe(heard);
      server.last().says(listOf('a', 'b'));
      list.naming('a', 'Fix the login');
      heard.mockClear();
      list.naming('a', null);
      expect(titles(list)).toEqual(['a', 'b']);
      expect(heard).toHaveBeenCalled();
    });
  });

  it('drops a shell ended here at once: nothing of it is kept', () => {
    const { server, list } = setup();
    list.subscribe(vi.fn());
    server.last().says({ type: 'sessions', machine: 'local', sessions: [{ ...session('a'), kind: 'shell' }, session('b')] });
    list.ends('a');
    expect(list.current()?.map((s) => s.id)).toEqual(['b']);
  });

  it('forgets the list on logout, closing a socket still lingering from the login that ended', () => {
    const { server, list, storage, onSignedOut } = setup();
    const off = list.subscribe(vi.fn());
    server.last().says(listOf('a'));
    off();
    list.forget();
    expect(list.current()).toBeNull();
    expect(storage.data.has(SESSIONS_KEY)).toBe(false);
    expect(server.last().closed).toBe(true);
    server.last().ends(4401);
    expect(onSignedOut).not.toHaveBeenCalled();
    // The next login starts a socket of its own.
    list.subscribe(vi.fn());
    expect(server.sockets).toHaveLength(2);
  });

  it('dates the lists of the next login by its own Mac only, whose clock may be behind the last one', () => {
    const { server, list } = setup();
    list.subscribe(vi.fn());
    server.last().says({ ...listOf('demo'), asOf: 5_000 });
    list.forget();
    list.reopen();
    server.last().says({ ...listOf('mine'), asOf: 1_000 });
    expect(list.current()?.map((s) => s.id)).toEqual(['mine']);
  });

  describe('ended sessions', () => {
    it('are remembered as they last were, whether the Mac dropped them or this device ended them', () => {
      const { server, list } = setup();
      list.subscribe(vi.fn());
      server.last().says(listOf('a', 'b', 'c'));
      server.last().says(listOf('a', 'c'));
      list.drop('c');
      expect(list.ended('b')).toMatchObject({ id: 'b', kind: 'claude', cwd: '/p' });
      expect(list.ended('c')?.id).toBe('c');
      expect(list.ended('a')).toBeNull();
      expect(list.ended('never')).toBeNull();
    });

    it('are kept on the device, the newest 50, and forgotten on logout', () => {
      const { server, list, storage } = setup();
      list.subscribe(vi.fn());
      const ids = Array.from({ length: 60 }, (_, i) => `s${i}`);
      server.last().says(listOf(...ids));
      for (let i = 0; i < 60; i++) server.last().says(listOf(...ids.slice(i + 1)));
      const again = createSessionList({ open: server.open, storage, visibility: fakeVisibility(), onSignedOut: vi.fn() });
      expect(again.ended('s59')?.id).toBe('s59');
      expect(again.ended('s10')?.id).toBe('s10');
      expect(again.ended('s9')).toBeNull();
      again.forget();
      expect(again.ended('s59')).toBeNull();
    });

    it('come back to life when the Mac lists them again', () => {
      const { server, list } = setup();
      list.subscribe(vi.fn());
      server.last().says(listOf('a'));
      server.last().says(listOf());
      server.last().says(listOf('a'));
      expect(list.ended('a')).toBeNull();
    });
  });

  describe('while the socket brings nothing', () => {
    const ids = (list: { current: () => TermSession[] | null }) => list.current()?.map((s) => s.id);
    const answers = (...lists: unknown[]) => {
      const ask = vi.fn(async () => (lists.length > 1 ? lists.shift() : lists[0]));
      return ask;
    };

    it('asks 3 s after the socket is made, then every 5 s, taking what comes back until the socket brings the list', async () => {
      const ask = answers(listOf('a'));
      const { server, list } = setup(memoryStorage(), ask);
      list.subscribe(vi.fn());
      await vi.advanceTimersByTimeAsync(2999);
      expect(ask).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(ask).toHaveBeenCalledTimes(1);
      expect(ids(list)).toEqual(['a']);
      await vi.advanceTimersByTimeAsync(5000);
      expect(ask).toHaveBeenCalledTimes(2);
      server.last().opens();
      server.last().says(listOf('b'));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(ask).toHaveBeenCalledTimes(2);
      expect(ids(list)).toEqual(['b']);
    });

    it('keeps asking while the socket is open but has said nothing', async () => {
      const ask = answers(listOf('a'));
      const { server, list } = setup(memoryStorage(), ask);
      list.subscribe(vi.fn());
      server.last().opens();
      await vi.advanceTimersByTimeAsync(3000 + 5000);
      expect(ask).toHaveBeenCalledTimes(2);
    });

    it('asks one at a time, a slow answer holding back the next ask', async () => {
      let answer!: (v: unknown) => void;
      const ask = vi.fn(() => new Promise((r) => (answer = r)));
      const { server, list, visibility } = setup(memoryStorage(), ask);
      list.subscribe(vi.fn());
      await vi.advanceTimersByTimeAsync(3000);
      server.last().ends(1006);
      visibility.set(true);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(ask).toHaveBeenCalledTimes(1);
      answer(listOf('a'));
      await vi.advanceTimersByTimeAsync(0);
      expect(ids(list)).toEqual(['a']);
      await vi.advanceTimersByTimeAsync(4999);
      expect(ask).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(ask).toHaveBeenCalledTimes(2);
    });

    it('waits out an ask already due when a new socket is made rather than asking twice', async () => {
      const ask = answers(listOf('a'));
      const { list, visibility } = setup(memoryStorage(), ask);
      list.subscribe(vi.fn());
      await vi.advanceTimersByTimeAsync(1000);
      visibility.set(true);
      await vi.advanceTimersByTimeAsync(2000);
      expect(ask).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(4999);
      expect(ask).toHaveBeenCalledTimes(1);
    });

    it('asks no more once nobody watches, when the list was released during an ask', async () => {
      let answer!: (v: unknown) => void;
      const ask = vi.fn(() => new Promise((r) => (answer = r)));
      const { list } = setup(memoryStorage(), ask);
      const off = list.subscribe(vi.fn());
      await vi.advanceTimersByTimeAsync(3000);
      off();
      await vi.advanceTimersByTimeAsync(5000);
      answer(listOf('a'));
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(ask).toHaveBeenCalledTimes(1);
    });

    it('asks again 5 s after an ask that failed', async () => {
      const ask = vi.fn().mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValue(listOf('a'));
      const { list } = setup(memoryStorage(), ask);
      list.subscribe(vi.fn());
      await vi.advanceTimersByTimeAsync(3000);
      expect(list.current()).toBeNull();
      await vi.advanceTimersByTimeAsync(5000);
      expect(ids(list)).toEqual(['a']);
    });

    it('takes no answer read before the list it already has', async () => {
      const ask = answers({ ...listOf('older'), asOf: 100 }, { ...listOf('as old'), asOf: 200 }, { ...listOf('undated') }, { ...listOf('newer'), asOf: 300 });
      const { server, list } = setup(memoryStorage(), ask);
      list.subscribe(vi.fn());
      server.last().says({ ...listOf('now'), asOf: 200 });
      await vi.advanceTimersByTimeAsync(3000);
      expect(ids(list)).toEqual(['now']);
      await vi.advanceTimersByTimeAsync(5000);
      expect(ids(list)).toEqual(['as old']);
      await vi.advanceTimersByTimeAsync(5000);
      expect(ids(list)).toEqual(['undated']);
      await vi.advanceTimersByTimeAsync(5000);
      expect(ids(list)).toEqual(['newer']);
    });

    it('asks again 3 s after a socket that brought the list closes', async () => {
      const ask = answers(listOf('a'));
      const { server, list } = setup(memoryStorage(), ask);
      list.subscribe(vi.fn());
      server.last().opens();
      server.last().says(listOf('b'));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(ask).not.toHaveBeenCalled();
      server.last().ends(1006);
      await vi.advanceTimersByTimeAsync(2999);
      expect(ask).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(ask).toHaveBeenCalledTimes(1);
    });

    it('asks while the socket lingers and stops once it is released', async () => {
      const ask = answers(listOf('a'));
      const { list } = setup(memoryStorage(), ask);
      const off = list.subscribe(vi.fn());
      await vi.advanceTimersByTimeAsync(1000);
      off();
      await vi.advanceTimersByTimeAsync(2000);
      expect(ask).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3000);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(ask).toHaveBeenCalledTimes(1);
    });
  });

  describe('journal heads from the socket', () => {
    const heads = (o: Record<string, unknown> = {}) => ({ type: 'heads', machine: 'local', epoch: 'e1', heads: { a: 3 }, ...o });

    it('are passed on to the sessions until the socket closes', () => {
      const { server, list } = setup();
      list.subscribe(vi.fn());
      server.last().says(heads());
      expect(caughtUp('a', { epoch: 'e1', v: 3 })).toBe(true);
      server.last().ends(1006);
      expect(caughtUp('a', { epoch: 'e1', v: 3 })).toBe(false);
    });

    it.each([
      ['another machine', { machine: 'other' }],
      ['no epoch', { epoch: 3 }],
      ['no heads', { heads: null }],
      ['heads that are not a map', { heads: 'a=3' }],
    ])('are not taken from a message with %s', (_, o) => {
      const { server, list } = setup();
      list.subscribe(vi.fn());
      server.last().says(heads());
      server.last().says(heads(o));
      expect(caughtUp('a', { epoch: 'e1', v: 3 })).toBe(true);
    });

    it('are not known while a new socket has said nothing yet', () => {
      const { server, list, visibility } = setup();
      list.subscribe(vi.fn());
      server.last().says(heads());
      visibility.set(true);
      expect(caughtUp('a', { epoch: 'e1', v: 3 })).toBe(false);
    });
  });

  describe('when forgotten while a screen still watches', () => {
    it('opens a socket again for the next login, and none when nobody watches', () => {
      const { server, list } = setup();
      list.subscribe(vi.fn());
      list.forget();
      list.reopen();
      expect(server.sockets).toHaveLength(2);
      expect(server.last().closed).toBe(false);
      const quiet = setup();
      quiet.list.forget();
      quiet.list.reopen();
      expect(quiet.server.sockets).toHaveLength(0);
    });

    it('is forgotten even when storage is blocked', () => {
      const { list } = setup(brokenStorage as never);
      expect(() => list.forget()).not.toThrow();
      expect(list.current()).toBeNull();
      expect(list.ended('a')).toBeNull();
    });
  });

  describe('a slow socket', () => {
    it.each([
      ['one that opened', (s: FakeSocket) => s.opens(), 101],
      ['one that failed to', (s: FakeSocket) => s.ends(1006), 'network'],
    ])('tells %s slowly, once', (_, settle, outcome) => {
      const onSlow = vi.fn();
      const { server } = (() => {
        const t = setup(memoryStorage(), undefined, onSlow);
        t.list.subscribe(vi.fn());
        return t;
      })();
      const sock = server.last();
      vi.advanceTimersByTime(SLOW_MS);
      settle(sock);
      if (sock.isOpen()) sock.ends(1006);
      expect(onSlow.mock.calls).toEqual([[{ method: 'WS', path: '/api/events', ms: SLOW_MS, outcome }]]);
    });

    it('tells nothing of a socket that opened in time', () => {
      const onSlow = vi.fn();
      const { server } = (() => {
        const t = setup(memoryStorage(), undefined, onSlow);
        t.list.subscribe(vi.fn());
        return t;
      })();
      vi.advanceTimersByTime(SLOW_MS - 1);
      server.last().opens();
      vi.advanceTimersByTime(SLOW_MS);
      server.last().ends(1006);
      expect(onSlow).not.toHaveBeenCalled();
    });
  });
});
