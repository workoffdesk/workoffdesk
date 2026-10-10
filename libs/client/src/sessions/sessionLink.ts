import { MACHINE, socketOpening, type Slow, type TermSession } from '../base/api';
import { CLOSE_GONE, CLOSE_RESTARTING, CLOSE_SIGNED_OUT, type OpenSocket, type Socket, type Visibility } from '../base/platform';
import { onAskScreen, onHaveJournal, onWatchScreenText, pushed, screenTextWatched, type JournalAt, type Push } from '../journal/pushes';
import { restartDelay } from '../base/retry';

export type LinkState = 'connecting' | 'live' | 'reconnecting' | 'ended';

type Shown = Pick<TermSession, 'kind' | 'status'>;
// What a session's header says of it: only what is known now. While what it shows has stopped coming the
// list's last word may be stale, so it says only that it is reconnecting.
export function headerStatus(s: Shown, down: boolean, ended: boolean): Shown | 'reconnecting' {
  if (ended) return { kind: s.kind, status: 'ended' };
  return down ? 'reconnecting' : s;
}

export type SessionLink = {
  // Whether the data reached an open connection. Nothing is kept to go later: what was typed for a moment
  // that has passed should not run by itself once the connection is back.
  send: (data: string) => boolean;
  close: () => void;
};

export type SessionLinkConfig = {
  open: OpenSocket;
  visibility: Visibility;
  // The server no longer takes this login.
  onSignedOut: () => void;
  // A line that took SLOW_MS or more to open or to fail, told as a request is (api.ts).
  onSlow?: (slow: Slow) => void;
};

const MAX_DELAY = 30_000;
// How long the line is down before the person is told: one made again within moments (coming back to the
// app, a restart of the Mac side, a blink) is not news.
export const DOWN_SAID_AFTER_MS = 8000;
const encoder = new TextEncoder();

// The line to a session that carries what is typed: it reconnects on its own, tells the Mac whether the
// session is being looked at (its page is in front: `page`), hands on what the Mac pushes (pushes.ts), and
// says when the session is gone.
export function createSessionLinks(config: SessionLinkConfig) {
  return {
    open(sessionId: string, page: Visibility, onState: (s: LinkState) => void): SessionLink {
      let ws: Socket | null = null;
      let delay = 1000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let downTimer: ReturnType<typeof setTimeout> | undefined;
      let ended = false;

      const sendRaw = (data: string | Uint8Array) => {
        if (!ws?.isOpen()) return false;
        ws.send(data);
        return true;
      };
      const reportVisible = () => sendRaw(JSON.stringify({ type: 'visible', visible: page.visible() }));
      // Where the session's journal copy is, for the Mac to send what follows it; said again on each new line.
      let journal: JournalAt | null = null;
      const reportJournal = () => journal && sendRaw(JSON.stringify({ type: 'journal', ...journal }));
      // Whether the screen is watched as text; said again on each new line while it is.
      const reportText = (on: boolean) => sendRaw(JSON.stringify({ type: 'screenText', on }));
      const stopTimers = () => {
        clearTimeout(timer);
        clearTimeout(downTimer);
        downTimer = undefined;
      };
      const end = () => {
        ended = true;
        stopTimers();
        onState('ended');
      };
      const down = () => {
        downTimer ??= setTimeout(() => onState('reconnecting'), DOWN_SAID_AFTER_MS);
      };

      const connect = () => {
        clearTimeout(timer);
        const path = `/api/m/${MACHINE}/sessions/${sessionId}/ws`;
        const settle = socketOpening(path, config.onSlow);
        const sock: Socket = config.open(path, {
          open: () => {
            settle(101);
            if (ws !== sock) return;
            delay = 1000;
            clearTimeout(downTimer);
            downTimer = undefined;
            reportVisible();
            reportJournal();
            if (screenTextWatched(sessionId)) reportText(true);
            onState('live');
          },
          message: (data) => {
            if (ws !== sock || typeof data !== 'string') return;
            const msg = JSON.parse(data) as Push | { type: 'exit' };
            if (msg.type === 'exit') end();
            else pushed(sessionId, msg);
          },
          close: (code) => {
            settle('network');
            if (ws !== sock || ended) return;
            if (CLOSE_SIGNED_OUT.includes(code)) return config.onSignedOut();
            if (code === CLOSE_GONE) return end();
            down();
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

      // A socket can stay open while nothing comes through it any more: with the app back in front, the line
      // is made again.
      const onAppVisibility = () => {
        if (config.visibility.visible() && !ended) {
          delay = 1000;
          const old = ws;
          ws = null;
          old?.close();
          connect();
        }
      };
      const stopListening = config.visibility.onChange(onAppVisibility);
      const stopPage = page.onChange(reportVisible);
      const stopJournal = onHaveJournal(sessionId, (at) => {
        journal = at;
        reportJournal();
      });
      const stopText = onWatchScreenText(sessionId, reportText);
      const stopAsk = onAskScreen(sessionId, () => sendRaw(JSON.stringify({ type: 'screen' })));
      onState('connecting');
      connect();

      return {
        send: (data) => sendRaw(encoder.encode(data)),
        close: () => {
          stopTimers();
          stopListening();
          stopPage();
          stopJournal();
          stopText();
          stopAsk();
          const old = ws;
          ws = null;
          old?.close();
        },
      };
    },
  };
}
