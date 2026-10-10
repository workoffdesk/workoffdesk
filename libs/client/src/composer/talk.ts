import { t } from '@workoffdesk/i18n';
import { errorText } from '../base/api';

// Listening, from start to end. stop() asks for what was still being worked out, which can come in
// afterwards, followed by the end; abort() ends it now and drops anything left.
export type Listening = { stop: () => void; abort: () => void };

// The platform's live speech recognition. onText gets everything heard so far, each time it changes; onEnd
// is called once when it has ended, with the reason if it was not asked to; onStart once the microphone is
// on. May throw when there is none.
export type Recognize = (onText: (heard: string) => void, onEnd: (error?: string) => void, onStart: () => void) => Listening;

// Where letting go would take what was said.
export type Zone = 'send' | 'cancel' | 'text';

// What the panel over the composer shows while a hold lasts.
export type Hold = {
  listening: boolean;
  heard: string;
  zone: Zone;
  // Let go to send, and waiting for the last words.
  finishing: boolean;
};

// One hold, from the press to the words going somewhere. Calls after it is over do nothing.
export type Talk = { move: (zone: Zone) => void; release: (zone: Zone) => void; drop: () => void };

export type TalkTo = {
  // The panel, or null once there is none.
  show: (hold: Hold | null) => void;
  // The composer's text, once the words go there rather than out.
  write: (text: string) => void;
  send: (heard: string) => void;
  // The recognizer stopped by itself, for a reason other than hearing nothing.
  failed: (error: string) => void;
  // Something to tell the user.
  say: (message: string) => void;
};

// How long the recognizer gets, once let go, to deliver the words it was still working out.
export const FINISH_MS = 1500;

// Held: what is heard shows above the bar as it comes. Let go and it is sent once the recognizer has
// delivered its last words, or has had FINISH_MS to; onto To text it goes into the composer the same way.
// Null when the recognizer could not start, which has been said.
export function startTalk(recognize: Recognize, to: TalkTo): Talk | null {
  let heard = '';
  let into: 'message' | 'composer' = 'message';
  let state: 'held' | 'finishing' | 'over' = 'held';
  let ended = false;
  let micOn = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hold: Hold = { listening: false, heard: '', zone: 'send', finishing: false };
  const show = (next: Hold) => {
    hold = next;
    if (into === 'message') to.show(hold);
  };
  const over = () => {
    state = 'over';
    clearTimeout(timer);
    to.show(null);
  };
  const finish = () => {
    if (state === 'over') return;
    over();
    if (!ended) listening.abort();
    // iOS asks for the microphone the first time, and the finger comes up on its dialog.
    if (!heard.trim()) return to.say(micOn ? t.notHeard : t.micJustOn);
    if (into === 'message') to.send(heard);
  };
  to.show(hold);
  let listening: Listening;
  try {
    listening = recognize(
      (h) => {
        if (state === 'over') return;
        heard = h;
        if (into === 'composer') to.write(h);
        else show({ ...hold, heard: h });
      },
      (error) => {
        ended = true;
        if (state === 'over') return;
        if (error && error !== 'no-speech' && error !== 'aborted') {
          over();
          return to.failed(error);
        }
        if (state === 'finishing') return finish();
        // Over while still held, before it ever listened: the hold would otherwise show a panel that hears nothing.
        if (!micOn) {
          over();
          to.say(t.speechUnavailable);
        }
      },
      () => {
        micOn = true;
        show({ ...hold, listening: true });
      },
    );
  } catch (e) {
    to.show(null);
    to.say(errorText(e, t.speechUnavailable));
    return null;
  }
  return {
    move: (zone) => {
      if (state === 'held' && hold.zone !== zone) show({ ...hold, zone });
    },
    release: (zone) => {
      if (state !== 'held') return;
      if (zone === 'cancel') {
        over();
        return listening.abort();
      }
      state = 'finishing';
      if (zone === 'text') {
        to.show(null);
        into = 'composer';
        to.write(heard);
      } else show({ ...hold, finishing: true });
      if (ended) return finish();
      listening.stop();
      timer = setTimeout(finish, FINISH_MS);
    },
    drop: () => {
      if (state === 'over') return;
      over();
      listening.abort();
    },
  };
}

// Why recognition stopped, in words, from the code the platform stopped with.
export function speechErrorText(code: string): string {
  if (code === 'language-not-supported') return t.speechLanguage;
  return t.speechErrors[code] ?? t.speechStopped;
}
