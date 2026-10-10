import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionLinks, DOWN_SAID_AFTER_MS, headerStatus, type LinkState } from '../../src/sessions/sessionLink';
import { onPush } from '../../src/journal/pushes';
import { fakeServer, fakeVisibility } from '../helpers/fakes';

function setup() {
  const server = fakeServer();
  const visibility = fakeVisibility();
  const onSignedOut = vi.fn();
  const links = createSessionLinks({ open: server.open, visibility, onSignedOut });
  const states: LinkState[] = [];
  const link = links.open('s1', (s) => states.push(s));
  return { server, visibility, onSignedOut, link, states };
}
type Setup = ReturnType<typeof setup>;

const decoded = (d: string | Uint8Array) => (typeof d === 'string' ? `text:${d}` : new TextDecoder().decode(d));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createSessionLinks', () => {
  it("opens the session's socket and, once open, says the user is looking", () => {
    const { server, states } = setup();
    expect(server.last().path).toBe('/api/m/local/sessions/s1/ws');
    expect(states).toEqual(['connecting']);
    server.last().opens();
    expect(states).toEqual(['connecting', 'live']);
    expect(server.last().sent).toEqual([JSON.stringify({ type: 'visible', visible: true })]);
  });

  it('sends what is typed as bytes, and says so only when the socket is open', () => {
    const { server, link } = setup();
    expect(link.send('x')).toBe(false);
    server.last().opens();
    expect(link.send('héllo\r')).toBe(true);
    const typed = server.last().sent.at(-1)!;
    expect(typed).toBeInstanceOf(Uint8Array);
    expect(decoded(typed)).toBe('héllo\r');
  });

  it('hands pushes to listeners for the session and ends on exit', () => {
    const { server, states } = setup();
    const heard = vi.fn();
    const off = onPush('s1', heard);
    server.last().opens();
    server.last().says({ type: 'alive' });
    expect(heard).toHaveBeenCalledWith({ type: 'alive' });
    server.last().says({ type: 'exit' });
    expect(states.at(-1)).toBe('ended');
    off();
  });

  it.each([4401, 4403])('sends a socket closed with %i to the login', (code) => {
    const { server, onSignedOut } = setup();
    server.last().ends(code);
    expect(onSignedOut).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    expect(server.sockets).toHaveLength(1);
  });

  it('ends for good when the session is gone (4404)', () => {
    const { server, states } = setup();
    server.last().ends(4404);
    expect(states.at(-1)).toBe('ended');
    vi.advanceTimersByTime(60_000);
    expect(server.sockets).toHaveLength(1);
  });

  it('does not reconnect for a session that has ended', () => {
    const { server, visibility } = setup();
    server.last().opens();
    server.last().says({ type: 'exit' });
    visibility.set(false);
    visibility.set(true);
    expect(server.sockets).toHaveLength(1);
  });

  it('reconnects after 1 s, 2 s … 30 s, back to 1 s once a socket opens', () => {
    const { server, states } = setup();
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
    expect(states.filter((x) => x === 'reconnecting')).toHaveLength(1);
    expect(states).toContain('reconnecting');
    server.last().opens();
    server.last().ends(1006);
    vi.advanceTimersByTime(1000);
    expect(server.sockets).toHaveLength(9);
  });

  // Back in front, the line iOS dropped while the app was away is made again: that is not news.
  it.each([
    ['dropped while away, made again on coming back', (x: Setup) => {
      x.visibility.set(false);
      x.server.last().ends(1006);
      x.visibility.set(true);
    }],
    ['dropped as the app comes back', (x: Setup) => {
      x.visibility.set(false);
      x.visibility.set(true);
      x.server.sockets[0].ends(1006);
    }],
    ['a blink', (x: Setup) => x.server.last().ends(1006)],
    ['a restart of the Mac side', (x: Setup) => x.server.last().ends(4012)],
  ])('says nothing of a line made again within moments: %s', (_, drop) => {
    const x = setup();
    x.server.last().opens();
    drop(x);
    // Past the first try, short of saying so.
    vi.advanceTimersByTime(DOWN_SAID_AFTER_MS - 1);
    x.server.last().opens();
    vi.advanceTimersByTime(60_000);
    expect(x.server.sockets.length).toBeGreaterThan(1);
    expect(x.states).toEqual(['connecting', 'live', 'live']);
  });

  it('says it is reconnecting once the line has stayed down a while, through the tries between', () => {
    const { server, states } = setup();
    server.last().opens();
    server.last().ends(1006);
    vi.advanceTimersByTime(1000);
    server.last().ends(1006);
    vi.advanceTimersByTime(DOWN_SAID_AFTER_MS - 1001);
    expect(states).toEqual(['connecting', 'live']);
    vi.advanceTimersByTime(1);
    expect(states).toEqual(['connecting', 'live', 'reconnecting']);
    vi.advanceTimersByTime(2000);
    server.last().opens();
    expect(states).toEqual(['connecting', 'live', 'reconnecting', 'live']);
  });

  it('says nothing more once closed or ended while the line is down', () => {
    const a = setup();
    a.server.last().ends(1006);
    a.link.close();
    vi.advanceTimersByTime(60_000);
    expect(a.states).toEqual(['connecting']);
    const b = setup();
    b.server.last().opens();
    b.server.last().ends(1006);
    vi.advanceTimersByTime(1000);
    b.server.last().ends(4404);
    vi.advanceTimersByTime(60_000);
    expect(b.states).toEqual(['connecting', 'live', 'ended']);
  });

  it('comes back within 250–750 ms when the server restarts (4012)', () => {
    const { server } = setup();
    server.last().ends(4012);
    vi.advanceTimersByTime(249);
    expect(server.sockets).toHaveLength(1);
    vi.advanceTimersByTime(501);
    expect(server.sockets).toHaveLength(2);
  });

  it('tells the Mac when the user looks away and reconnects when they are back', () => {
    const { server, visibility } = setup();
    const first = server.last();
    first.opens();
    visibility.set(false);
    expect(first.sent.at(-1)).toBe(JSON.stringify({ type: 'visible', visible: false }));
    expect(server.sockets).toHaveLength(1);
    visibility.set(true);
    expect(first.closed).toBe(true);
    expect(server.sockets).toHaveLength(2);
    first.ends(1006);
    vi.advanceTimersByTime(60_000);
    expect(server.sockets).toHaveLength(2);
  });

  it('stays closed once closed, neither reconnecting nor listening', () => {
    const { server, visibility, link } = setup();
    link.close();
    expect(server.last().closed).toBe(true);
    expect(visibility.listeners.size).toBe(0);
    server.last().ends(1006);
    vi.advanceTimersByTime(60_000);
    expect(server.sockets).toHaveLength(1);
  });
});

describe('headerStatus', () => {
  const idle = { kind: 'claude', status: 'idle' } as const;

  it("shows what the list last said while the session's output keeps coming", () => {
    expect(headerStatus(idle, false, false)).toEqual(idle);
  });

  it('says only that it is reconnecting once the output stopped, not the stale status', () => {
    expect(headerStatus(idle, true, false)).toBe('reconnecting');
    expect(headerStatus({ kind: 'shell', status: null }, true, false)).toBe('reconnecting');
  });

  it.each([false, true])('says ended once the session has, down %s', (down) => {
    expect(headerStatus(idle, down, true)).toEqual({ kind: 'claude', status: 'ended' });
  });
});
