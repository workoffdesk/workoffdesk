import { describe, expect, it } from 'vitest';
import { anyOf, inFront, standardSocket } from '../../src/base/platform';
import { fakeVisibility } from '../helpers/fakes';

// A browser's WebSocket as far as standardSocket uses it: its handlers, its state, what is sent and closed.
const webSocket = () => {
  const ws = {
    readyState: 0,
    sent: [] as (string | Uint8Array)[],
    closed: 0,
    onopen: null as unknown,
    onmessage: null as unknown,
    onclose: null as unknown,
    send(data: string | Uint8Array) {
      this.sent.push(data);
    },
    close() {
      this.closed++;
    },
  };
  return ws;
};

describe('standardSocket', () => {
  it('passes on what the socket says and is open only while it is', () => {
    const ws = webSocket();
    const heard: unknown[] = [];
    const socket = standardSocket(ws, { open: () => heard.push('open'), message: (d) => heard.push(d), close: (c) => heard.push(c) });
    expect(socket.isOpen()).toBe(false);
    ws.readyState = 1;
    (ws.onopen as () => void)();
    expect(socket.isOpen()).toBe(true);
    (ws.onmessage as (e: { data: unknown }) => void)({ data: '{"type":"out"}' });
    ws.readyState = 3;
    (ws.onclose as (e: { code: number }) => void)({ code: 4401 });
    expect(socket.isOpen()).toBe(false);
    expect(heard).toEqual(['open', '{"type":"out"}', 4401]);
  });

  it('sends and closes on the socket itself', () => {
    const ws = webSocket();
    const socket = standardSocket(ws, { open() {}, message() {}, close() {} });
    const bytes = new Uint8Array([1, 2]);
    socket.send('hello');
    socket.send(bytes);
    socket.close();
    expect(ws.sent).toEqual(['hello', bytes]);
    expect(ws.closed).toBe(1);
  });
});

describe('inFront', () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('is visible with the app visible %s and the screen in front %s: %s', (app, front, visible) => {
    expect(inFront(fakeVisibility(app), front).visible()).toBe(visible);
  });

  it('tells its listeners each time that changes, from the app or from the screen, and only then', () => {
    const app = fakeVisibility(true);
    const screen = inFront(app, true);
    const told: boolean[] = [];
    const stop = screen.onChange(() => told.push(screen.visible()));
    screen.setFront(false);
    app.set(false);
    screen.setFront(true);
    app.set(true);
    screen.setFront(true);
    expect(told).toEqual([false, true]);
    stop();
    screen.setFront(false);
    expect(told).toEqual([false, true]);
    expect(app.listeners.size).toBe(0);
  });
});

describe('anyOf', () => {
  it('is visible while any page added to it is, and tells its listeners each time that changes', () => {
    const shared = anyOf();
    const told: boolean[] = [];
    shared.onChange(() => told.push(shared.visible()));
    expect(shared.visible()).toBe(false);
    const a = fakeVisibility(false);
    const b = fakeVisibility(true);
    const removeA = shared.add(a);
    const removeB = shared.add(b);
    a.set(true);
    b.set(false);
    a.set(false);
    expect(told).toEqual([true, false]);
    a.set(true);
    removeA();
    removeA();
    expect(told).toEqual([true, false, true, false]);
    expect(a.listeners.size).toBe(0);
    removeB();
    b.set(true);
    expect(shared.visible()).toBe(false);
  });

  it('counts a page added twice until both are removed', () => {
    const shared = anyOf();
    const page = fakeVisibility(true);
    const first = shared.add(page);
    const second = shared.add(page);
    first();
    expect(shared.visible()).toBe(true);
    second();
    expect(shared.visible()).toBe(false);
  });
});
