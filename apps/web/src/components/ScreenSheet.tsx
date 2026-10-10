import { useLayoutEffect, useRef } from 'react';
import { useScreenText, type Keys } from '@workoffdesk/react/screenText';
import { api } from '../api';
import { KeyBar } from './KeyBar';
import { Sheet } from './Sheet';
import { t } from '@workoffdesk/i18n';

// The session's screen on the Mac as it is right now, as text, for what the chat cannot make out. The Mac
// pushes it on the session's line each time it changes; when the line is not live it is asked for, one
// request at a time. With keys it can be answered while watched.
export function ScreenSheet({ sessionId, onClose, keys }: { sessionId: string; onClose: () => void; keys?: Keys }) {
  const { text, failed, refresh, keyed } = useScreenText(api, sessionId, () => document.visibilityState === 'visible');
  // Opened at the bottom, where the prompt is, below what scrolled off; after that it stays where it is read.
  const screen = useRef<HTMLPreElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (placed.current || !screen.current) return;
    placed.current = true;
    screen.current.scrollTop = screen.current.scrollHeight;
  }, [text]);
  return (
    <Sheet
      title={t.screenTitle}
      onClose={onClose}
      className="screen-sheet"
      head={
        <button
          className="btn small"
          onClick={refresh}
        >
          {t.refresh}
        </button>
      }
    >
      {failed && (
        <div className="alert" role="alert">
          {t.screenUnread}
        </div>
      )}
      {text === null ? (
        <div className="screen-text">{!failed && <p className="muted center">{t.reading}</p>}</div>
      ) : (
        <pre ref={screen} className="screen-text" aria-label={t.screenContent}>
          {text || t.screenEmpty}
        </pre>
      )}
      {keys && (
        <KeyBar
          ctrlArmed={keys.ctrlArmed}
          onCtrl={keys.onCtrl}
          onPaste={() => {
            keys.onPaste();
            keyed();
          }}
          onKey={(seq) => {
            keys.onKey(seq);
            keyed();
          }}
        />
      )}
    </Sheet>
  );
}
