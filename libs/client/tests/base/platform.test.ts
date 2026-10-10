import { describe, expect, it } from 'vitest';
import { standardSocket } from '../../src/base/platform';

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
