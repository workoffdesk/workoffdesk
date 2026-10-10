import { MACHINE, type Api } from '@workoffdesk/client/base/api';
import { live, onPush, watchScreenText } from '@workoffdesk/client/journal/pushes';
import { useEffect, useRef, useState } from 'react';

// How often the sheet looks whether it must read the screen itself: only while the session's line is not
// pushing it.
const SCREEN_EVERY_MS = 2000;
// How long a key is given to show on the screen before it is read again.
const KEY_SHOWS_MS = 300;

// Keys a phone keyboard lacks, sent as they are; Ctrl applies to the next key typed.
export type Keys = { ctrlArmed: boolean; onCtrl: () => void; onKey: (seq: string) => void; onPaste: () => void };

// The session's screen on the Mac as it is right now, as text. The Mac pushes it on the session's line each
// time it changes; when the line is not live it is asked for, one request at a time, while the app is in
// front (`inFront`).
export function useScreenText(api: Api, sessionId: string, inFront: () => boolean) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const read = useRef<(force?: boolean) => void>(() => {});
  useEffect(() => {
    let gone = false;
    let pushedHere = false;
    let reading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (s: string) => {
      if (gone) return;
      setText(s);
      setFailed(false);
    };
    const next = (ms: number) => {
      clearTimeout(timer);
      if (!gone) timer = setTimeout(() => read.current(), ms);
    };
    read.current = async (force = false) => {
      const pushing = pushedHere && live(sessionId);
      if (reading || (!force && (pushing || !inFront()))) return next(SCREEN_EVERY_MS);
      reading = true;
      try {
        show((await api<{ text: string }>(`/api/m/${MACHINE}/sessions/${sessionId}/screen`)).text);
      } catch {
        if (!gone) setFailed(true);
      } finally {
        reading = false;
      }
      next(SCREEN_EVERY_MS);
    };
    const unpush = onPush(sessionId, (p) => {
      if (p.type !== 'screenText') return;
      pushedHere = true;
      show(p.text);
    });
    const unwatch = watchScreenText(sessionId);
    // A live line sends the screen at once; it is asked for only if it does not come.
    next(live(sessionId) ? SCREEN_EVERY_MS : 0);
    return () => {
      gone = true;
      clearTimeout(timer);
      unpush();
      unwatch();
    };
  }, [sessionId]);
  const refresh = () => {
    setFailed(false);
    read.current(true);
  };
  // A key shows on the screen in a moment: a line that pushes sends it, otherwise it is asked for.
  const keyed = () => setTimeout(() => read.current(), KEY_SHOWS_MS);
  return { text, failed, refresh, keyed };
}
