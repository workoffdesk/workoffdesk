// What differs between the web app and the iPhone app, handed to what the two share.

// Strings kept on the device under a key: the browser's localStorage, the app's own store. Any call may
// throw (storage blocked, full or cleared); what is kept is only ever a head start.
export type KeyValue = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

// Whether the user is looking: the page in front, the app in the foreground.
export type Visibility = {
  visible(): boolean;
  // Returns the way to stop listening.
  onChange(listener: () => void): () => void;
};

export type SocketEvents = {
  open(): void;
  message(data: unknown): void;
  close(code: number): void;
};

export type Socket = {
  isOpen(): boolean;
  send(data: string | Uint8Array): void;
  close(): void;
};

// A WebSocket to a path on the server, signed in as the rest of the client is: by the cookie in a browser,
// by a header in the app.
export type OpenSocket = (path: string, on: SocketEvents) => Socket;

// A browser's or React Native's WebSocket; their handler types differ, what is used of them does not.
type StandardWebSocket = {
  readonly readyState: number;
  send(data: string | Uint8Array): void;
  close(): void;
  onopen: unknown;
  onmessage: unknown;
  onclose: unknown;
};

const OPEN = 1;

export function standardSocket(ws: StandardWebSocket, on: SocketEvents): Socket {
  const handlers = ws as unknown as {
    onopen: () => void;
    onmessage: (e: { data: unknown }) => void;
    onclose: (e: { code: number }) => void;
  };
  handlers.onopen = () => on.open();
  handlers.onmessage = (e) => on.message(e.data);
  handlers.onclose = (e) => on.close(e.code);
  return {
    isOpen: () => ws.readyState === OPEN,
    send: (data) => ws.send(data),
    close: () => ws.close(),
  };
}

// Close codes the server ends a socket with.
export const CLOSE_SIGNED_OUT = [4401, 4403];
export const CLOSE_RESTARTING = 4012;
export const CLOSE_GONE = 4404;
