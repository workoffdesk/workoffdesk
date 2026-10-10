import type { Listening } from '@workoffdesk/client/composer/talk';
import { speechLocale, t } from '@workoffdesk/i18n';

type SpeechResults = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
type BrowserSpeech = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: SpeechResults }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export class NoLiveSpeech extends Error {}

const recognition = () => {
  const w = window as unknown as Record<string, (new () => BrowserSpeech) | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export const hasLiveSpeech = () => recognition() !== undefined;

// The browser's own recognition (a Recognize in talk.ts), which shows words while they are spoken. On an
// iPhone it is Apple's dictation, which may send the sound to Apple.
export function startLiveSpeech(onText: (heard: string) => void, onEnd: (error?: string) => void, onStart?: () => void): Listening {
  const Recognition = recognition();
  if (!Recognition) throw new NoLiveSpeech(t.noLiveSpeech);
  const r = new Recognition();
  r.lang = speechLocale;
  r.continuous = true;
  r.interimResults = true;
  let error: string | undefined;
  r.onresult = (e) => onText(Array.from(e.results, (result) => result[0].transcript).join(''));
  r.onerror = (e) => (error = e.error);
  r.onstart = () => onStart?.();
  r.onend = () => onEnd(error);
  r.start();
  return { stop: () => r.stop(), abort: () => r.abort() };
}
