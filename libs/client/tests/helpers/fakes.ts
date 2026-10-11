import type { Api, ApiInit, TermSession } from '../../src/base/api';
import { emptyView, type JournalRow, type SessionView } from '../../src/journal/journalRows';
import type { KeyValue, OpenSocket, Socket, SocketEvents, Visibility } from '../../src/base/platform';

// A socket the test drives by hand: it opens, says things and closes when told to.
export class FakeSocket implements Socket {
  open = false;
  closed = false;
  sent: (string | Uint8Array)[] = [];
  constructor(
    readonly path: string,
    readonly on: SocketEvents,
  ) {}
  isOpen = () => this.open && !this.closed;
  send = (data: string | Uint8Array) => void this.sent.push(data);
  close = () => {
    this.closed = true;
  };
  // What the server does.
  opens() {
    this.open = true;
    this.on.open();
  }
  says(msg: unknown) {
    this.on.message(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  ends(code: number) {
    this.closed = true;
    this.on.close(code);
  }
}

export function fakeServer() {
  const sockets: FakeSocket[] = [];
  const open: OpenSocket = (path, on) => {
    const s = new FakeSocket(path, on);
    sockets.push(s);
    return s;
  };
  return { open, sockets, last: () => sockets.at(-1)! };
}

export function memoryStorage(initial: Record<string, string> = {}): KeyValue & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

export const brokenStorage: KeyValue = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

export function fakeVisibility(visible = true): Visibility & { set(v: boolean): void; listeners: Set<() => void> } {
  const listeners = new Set<() => void>();
  let now = visible;
  return {
    listeners,
    visible: () => now,
    onChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set(v) {
      now = v;
      for (const l of [...listeners]) l();
    },
  };
}

// Lets promise callbacks run, as many rounds as an answer takes to reach the store.
export const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

type Waiting = { call: string; init: ApiInit; resolve: (v: unknown) => void; reject: (e: unknown) => void };

// The server, one request at a time: each waits until the test answers or fails it, by "METHOD path".
export function fakeApi() {
  const waiting: Waiting[] = [];
  const api = ((path: string, init: ApiInit = {}) =>
    new Promise<unknown>((resolve, reject) => waiting.push({ call: `${init.method ?? 'GET'} ${path}`, init, resolve, reject }))) as Api;
  const take = (call: string) => {
    const i = waiting.findIndex((w) => w.call === call);
    if (i < 0) throw new Error(`nothing waits as ${call}; waiting: ${waiting.map((w) => w.call).join(', ') || 'nothing'}`);
    return waiting.splice(i, 1)[0];
  };
  return {
    api,
    waiting: () => waiting.map((w) => w.call),
    init: (call: string) => waiting.find((w) => w.call === call)?.init,
    async answer(call: string, value?: unknown) {
      take(call).resolve(value);
      await flush();
    },
    async fail(call: string, error: unknown) {
      take(call).reject(error);
      await flush();
    },
  };
}

// The journals store as a session screen uses it: the test sets the view; what was asked of it is listed.
export function fakeJournals() {
  const views = new Map<string, SessionView>();
  const listeners = new Map<string, Set<() => void>>();
  const asked: string[] = [];
  const sent: { id: string; text: string; ok: () => void; fail: (e: unknown) => void }[] = [];
  // Whether each followed session's page is in front, as follow was told.
  const pages = new Map<string, Visibility>();
  return {
    asked,
    sent,
    pages,
    view: (id: string): SessionView => views.get(id) ?? emptyView,
    subscribe(id: string, listener: () => void): () => void {
      const set = listeners.get(id) ?? new Set();
      set.add(listener);
      listeners.set(id, set);
      return () => void set.delete(listener);
    },
    follow(id: string, page: Visibility): () => void {
      asked.push(`follow ${id}`);
      pages.set(id, page);
      return () => void asked.push(`unfollow ${id}`);
    },
    refresh: (id: string) => void asked.push(`refresh ${id}`),
    rereadScreen: (id: string) => void asked.push(`reread ${id}`),
    apply: (id: string, rows: JournalRow[]) => void asked.push(`apply ${id} ${rows.map((r) => r.key).join(',')}`),
    send: (id: string, text: string) => new Promise<void>((ok, fail) => sent.push({ id, text, ok, fail })),
    show(id: string, change: Partial<SessionView>) {
      views.set(id, { ...(views.get(id) ?? emptyView), ...change });
      for (const l of [...(listeners.get(id) ?? [])]) l();
    },
  };
}

export const aSession = (over: Partial<TermSession> = {}): TermSession => ({
  id: 's1',
  title: 'Fix the build',
  kind: 'claude',
  cwd: '/work/app',
  createdAt: 1,
  lastActivity: 1,
  status: 'idle',
  ...over,
});

// The session list as a screen reads it.
export function fakeList(current: TermSession[] | null, ended: TermSession[] = []) {
  let now = current;
  const listeners = new Set<() => void>();
  const dropped: string[] = [];
  const endedHere: string[] = [];
  return {
    dropped,
    endedHere,
    current: () => now,
    ended: (id: string) => ended.find((s) => s.id === id) ?? null,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    drop: (id: string) => void dropped.push(id),
    ends: (id: string) => void endedHere.push(id),
    set(next: TermSession[] | null) {
      now = next;
      for (const l of [...listeners]) l();
    },
  };
}
