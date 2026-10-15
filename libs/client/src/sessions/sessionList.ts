import { MACHINE, socketOpening, type Slow, type TermSession } from '../base/api';
import { CLOSE_RESTARTING, CLOSE_SIGNED_OUT, type KeyValue, type OpenSocket, type Socket, type Visibility } from '../base/platform';
import { journalHeads } from '../journal/pushes';
import { restartDelay } from '../base/retry';

// The last list is kept on the device, so an app opened afresh knows its sessions before the Mac has said
// anything. What waits to go to Claude is not kept: by the time the app opens again it may have gone, and
// only the Mac can say what it still holds.
export const SESSIONS_KEY = 'workoffdesk.sessions';
// Sessions that left the list, as they last were: a link to one (a notification tapped later) still shows
// whose it was, its conversation, and where to start another.
export const ENDED_KEY = 'workoffdesk.ended';
const ENDED_KEPT = 50;
// Going from one screen to another drops the last subscriber for a moment; the socket waits that out.
const LINGER_MS = 5000;
const MAX_DELAY = 30_000;
// A socket that has not got through this long is not waited on: the list is asked for this often, one ask
// at a time, until it does. Plain requests often cross a slow line when a socket cannot.
const ASK_AFTER_MS = 3000;
const ASK_EVERY_MS = 5000;

export type SessionListConfig = {
  open: OpenSocket;
  storage: KeyValue;
  visibility: Visibility;
  // The server no longer takes this login.
  onSignedOut: () => void;
  // What /api/events sends, asked for on its own (/api/events/now).
  ask?: () => Promise<unknown>;
  // A socket that took SLOW_MS or more to open or to fail, told as a request is (api.ts).
  onSlow?: (slow: Slow) => void;
};

export type SessionList = ReturnType<typeof createSessionList>;

// One live view of the session list for the whole client, fed by /api/events while anyone subscribes.
export function createSessionList(config: SessionListConfig) {
  const { storage } = config;
  const kept = (): TermSession[] | null => {
    try {
      const v = JSON.parse(storage.getItem(SESSIONS_KEY) ?? 'null');
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  const keep = (s: TermSession[]) => {
    try {
      storage.setItem(SESSIONS_KEY, JSON.stringify(s));
    } catch {
      // not kept; the next start waits for the Mac
    }
  };

  const read = (key: string): TermSession[] => {
    try {
      const v = JSON.parse(storage.getItem(key) ?? '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const write = (key: string, v: TermSession[]) => {
    try {
      storage.setItem(key, JSON.stringify(v));
    } catch {
      // not kept
    }
  };

  // What the Mac said, and what is shown: that, with the names given here it has not taken yet.
  let said = kept();
  let current = said;
  const names = new Map<string, string>();
  // When the Mac read the list last heard from it; null for one kept on the device.
  let asOf: number | null = null;
  const listeners = new Set<() => void>();
  let ws: Socket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lingering: ReturnType<typeof setTimeout> | undefined;
  let stopListening: (() => void) | null = null;
  let delay = 1000;
  // Whether the socket has brought a list since it was made.
  let heard = false;
  let asking = false;
  let askTimer: ReturnType<typeof setTimeout> | undefined;

  const publish = (s: TermSession[] | null) => {
    said = s;
    current = s && names.size ? s.map((x) => (names.has(x.id) ? { ...x, title: names.get(x.id)! } : x)) : s;
    for (const l of listeners) l();
  };

  // A new list: what left it is remembered as ended, what is in it is not.
  const settle = (next: TermSession[]) => {
    for (const s of next) if (names.get(s.id) === s.title) names.delete(s.id);
    const live = new Set(next.map((s) => s.id));
    const left = (said ?? []).filter((s) => !live.has(s.id));
    const ended = read(ENDED_KEY);
    if (left.length || ended.some((s) => live.has(s.id))) {
      const leftIds = new Set(left.map((s) => s.id));
      write(ENDED_KEY, [...left, ...ended.filter((s) => !live.has(s.id) && !leftIds.has(s.id))].slice(0, ENDED_KEPT));
    }
    publish(next);
    keep(next);
  };

  // A list from the socket or asked for; one read before the last taken is old news.
  const take = (msg: { type?: unknown; machine?: unknown; asOf?: unknown; sessions?: unknown; epoch?: unknown; heads?: unknown }) => {
    if (msg.type === 'heads' && msg.machine === MACHINE && typeof msg.epoch === 'string' && msg.heads && typeof msg.heads === 'object')
      return journalHeads({ epoch: msg.epoch, heads: msg.heads as Record<string, number> });
    if (msg.type !== 'sessions' || msg.machine !== MACHINE || !Array.isArray(msg.sessions)) return;
    const at = typeof msg.asOf === 'number' ? msg.asOf : null;
    if (at !== null && asOf !== null && at < asOf) return;
    asOf = at;
    settle(msg.sessions);
  };

  const listening = () => stopListening !== null;
  const needed = () => listening() && !!config.ask && !(heard && ws?.isOpen());
  const ask = async () => {
    clearTimeout(askTimer);
    askTimer = undefined;
    const asked = config.ask;
    if (!asked || !needed()) return;
    if (!asking) {
      asking = true;
      try {
        take((await asked()) as Parameters<typeof take>[0]);
      } catch {
        // the next ask, or the socket, brings it
      } finally {
        asking = false;
      }
    }
    if (needed() && askTimer === undefined) askTimer = setTimeout(ask, ASK_EVERY_MS);
  };
  const askLater = () => {
    if (config.ask && askTimer === undefined && !asking) askTimer = setTimeout(ask, ASK_AFTER_MS);
  };

  const connect = () => {
    clearTimeout(timer);
    heard = false;
    journalHeads(null);
    askLater();
    const settle = socketOpening('/api/events', config.onSlow);
    const sock: Socket = config.open('/api/events', {
      open: () => settle(101),
      message: (data) => {
        if (ws !== sock) return;
        delay = 1000;
        heard = true;
        take(JSON.parse(String(data)));
      },
      close: (code) => {
        settle('network');
        if (ws !== sock) return;
        ws = null;
        heard = false;
        journalHeads(null);
        askLater();
        if (CLOSE_SIGNED_OUT.includes(code)) return config.onSignedOut();
        // The Mac side is restarting and will be back in a moment.
        if (code === CLOSE_RESTARTING) {
          delay = 500;
          timer = setTimeout(connect, restartDelay());
          return;
        }
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, MAX_DELAY);
      },
    });
    ws = sock;
  };

  // Phones drop sockets in the background without saying so, and one can stay open while nothing comes
  // through it any more: back in front, the list is asked for afresh.
  const onVisibility = () => {
    if (!config.visibility.visible()) return;
    const old = ws;
    ws = null;
    old?.close();
    delay = 1000;
    connect();
  };

  const start = () => {
    clearTimeout(lingering);
    lingering = undefined;
    if (stopListening) return;
    stopListening = config.visibility.onChange(onVisibility);
    connect();
  };

  const stop = () => {
    stopListening?.();
    stopListening = null;
    clearTimeout(timer);
    clearTimeout(askTimer);
    askTimer = undefined;
    const sock = ws;
    ws = null;
    sock?.close();
  };

  return {
    current: () => current,

    // A session that has left the list, as it last was; null for one this device never saw.
    ended: (id: string): TermSession | null => read(ENDED_KEY).find((s) => s.id === id) ?? null,

    // For React's useSyncExternalStore: the listener is told that current() may have changed.
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        if (!listeners.delete(listener) || listeners.size) return;
        lingering = setTimeout(() => {
          lingering = undefined;
          stop();
        }, LINGER_MS);
      };
    },

    // A session deleted from here leaves the list at once, without waiting for the Mac to say so.
    drop(id: string) {
      if (!said) return;
      settle(said.filter((s) => s.id !== id));
    },

    // A session ended from here is at once what the Mac will list: a Claude or Codex one past, a shell gone.
    ends(id: string) {
      if (!said) return;
      settle(
        said.flatMap((s) =>
          s.id !== id ? [s] : s.kind === 'shell' ? [] : [{ ...s, past: true as const, status: 'ended' as const, usage: null }],
        ),
      );
    },

    // A name given a session here shows at once, until a list from the Mac has it; null takes it back.
    naming(id: string, title: string | null) {
      if (title === null) names.delete(id);
      else names.set(id, title);
      publish(said);
    },

    // What a logged-out device, or one now on another account, must not show. The socket of the login that
    // ended goes too, watched or lingering; `reopen` opens one with the login then in use.
    forget() {
      clearTimeout(lingering);
      lingering = undefined;
      stop();
      names.clear();
      asOf = null;
      publish(null);
      try {
        storage.removeItem(SESSIONS_KEY);
        storage.removeItem(ENDED_KEY);
      } catch {
        // nothing was kept
      }
    },

    // Still watched after forget, as a screen left open across a change of account is.
    reopen() {
      if (listeners.size) start();
    },
  };
}
