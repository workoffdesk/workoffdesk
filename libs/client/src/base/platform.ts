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

// A screen's own Visibility: visible while the app is and the screen is the one in front of it, not one with
// another pushed over it. Its listeners are told each time that changes.
export function inFront(app: Visibility, front: boolean): Visibility & { setFront(front: boolean): void } {
  const listeners = new Set<() => void>();
  const visible = () => front && app.visible();
  let was = visible();
  let stopApp: (() => void) | null = null;
  const check = () => {
    if (visible() === was) return;
    was = !was;
    for (const l of [...listeners]) l();
  };
  return {
    visible,
    onChange(listener) {
      if (!listeners.size) {
        was = visible();
        stopApp = app.onChange(check);
      }
      listeners.add(listener);
      return () => {
        if (!listeners.delete(listener) || listeners.size) return;
        stopApp?.();
        stopApp = null;
      };
    },
    setFront(now) {
      front = now;
      check();
    },
  };
}

// Visible while any page added to it is, as a thing shown by several screens at once; its listeners are
// told each time that changes.
export function anyOf(): Visibility & { add(page: Visibility): () => void } {
  const pages: Visibility[] = [];
  const listeners = new Set<() => void>();
  const visible = () => pages.some((p) => p.visible());
  let was = false;
  const check = () => {
    if (visible() === was) return;
    was = !was;
    for (const l of [...listeners]) l();
  };
  return {
    visible,
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    add(page) {
      pages.push(page);
      const stop = page.onChange(check);
      check();
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        stop();
        pages.splice(pages.indexOf(page), 1);
        check();
      };
    },
  };
}

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
