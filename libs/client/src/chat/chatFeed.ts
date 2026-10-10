import { ApiError, type Api } from '../base/api';
import { applyChat, applyOlder, emptyChat, hasOlder, type ChatRead, type ChatState } from '../model/chat';
import type { Visibility } from '../base/platform';

// How often to ask the Mac.
const POLL_MS = 1200;
// Reads failing for less than this are a blip (the tunnel blinked, the Mac side restarted) and show nothing.
const FAILED_AFTER_MS = 10_000;

// A copy of each chat kept on the device, so opening one shows it before the Mac answers: only ever a head
// start, so it may answer nothing.
export type ChatStore = {
  kept(sessionId: string): Promise<ChatState | null>;
  keep(sessionId: string, chat: ChatState): void;
};

export type ChatFeedConfig = {
  api: Api;
  visibility: Visibility;
  store?: ChatStore;
};

export type ChatFeed = {
  stop(): void;
  // beforeShow runs just before the earlier turns go in, while the screen still shows it as it was.
  older(beforeShow: () => void): Promise<void>;
};

export function createChatFeeds(config: ChatFeedConfig) {
  const { api, visibility, store } = config;
  // Kept while the client runs, so going back to a chat shows it at once and reads on from there.
  const memory = new Map<string, ChatState>();

  return {
    remembered: (sessionId: string): ChatState | null => memory.get(sessionId) ?? null,

    // What a logged-out device must not show the next person.
    forget: () => memory.clear(),

    // The chat as last shown here, then as kept on the device, then from the Mac; after that only what is
    // new is read. Earlier turns come a page at a time when asked for.
    // sessionId: what the chat is kept under on this device; url: where it is read from.
    follow(
      sessionId: string,
      url: string,
      on: { show(c: ChatState): void; failed(failed: boolean): void; loadingOlder(loading: boolean): void },
    ): ChatFeed {
      let latest = memory.get(sessionId) ?? null;
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let failingSince: number | null = null;
      let olderBusy = false;

      const show = (c: ChatState, keep = true) => {
        latest = c;
        memory.set(sessionId, c);
        on.show(c);
        if (keep) store?.keep(sessionId, c);
      };

      const read = async () => {
        timer = undefined;
        if (visibility.visible()) {
          const s = latest ?? emptyChat;
          try {
            const r = await api<ChatRead>(`${url}?from=${s.next}&sid=${s.sid ?? ''}`);
            // Earlier turns may have come in meanwhile: what is new goes on the copy as it is now.
            const now = latest ?? emptyChat;
            const unchanged = now.pages.length > 0 && r.sid === now.sid && r.from === now.next && r.next === now.next;
            if (stopped) return;
            if (!unchanged) show(applyChat(now, r));
            failingSince = null;
            on.failed(false);
          } catch (e) {
            if (stopped) return;
            // The Mac has no such conversation: there is nothing to read again.
            if (e instanceof ApiError && e.status === 404) {
              on.failed(false);
              return;
            }
            failingSince ??= Date.now();
            if (Date.now() - failingSince >= FAILED_AFTER_MS) on.failed(true);
          }
        }
        if (!stopped) timer = setTimeout(read, again ? 0 : POLL_MS);
        again = false;
      };
      // Read now rather than at the next turn of the clock; while a read is on its way, once more after it.
      let again = false;
      const readNow = () => {
        if (!timer) {
          again = true;
          return;
        }
        clearTimeout(timer);
        void read();
      };
      const unlisten = visibility.onChange(() => {
        if (visibility.visible()) readNow();
      });
      void (async () => {
        if (!latest && store) {
          const kept = await store.kept(sessionId);
          if (kept && !stopped && !latest) show(kept, false);
        }
        if (!stopped) void read();
      })();

      return {
        stop() {
          stopped = true;
          clearTimeout(timer);
          unlisten();
        },
        async older(beforeShow) {
          const s = latest;
          if (!s || !hasOlder(s) || olderBusy) return;
          olderBusy = true;
          on.loadingOlder(true);
          try {
            const r = await api<ChatRead>(`${url}?sid=${s.sid ?? ''}&before=${s.pages[0].start}`);
            const next = latest && applyOlder(latest, r);
            if (next && !stopped) {
              beforeShow();
              show(next);
            }
          } catch {
            // the next scroll to the top asks again
          } finally {
            olderBusy = false;
            on.loadingOlder(false);
          }
        },
      };
    },
  };
}
