import { hearLocale } from '@workoffdesk/client/composer/hearLocale';
import type { Recognize } from '@workoffdesk/client/composer/talk';
import { speechLocale } from '@workoffdesk/i18n';
import { getLocales } from 'expo-localization';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

// What Apple's recognizer takes, asked once; asked again next time if it could not be read.
let supported: Promise<string[]> | null = null;
const supportedLocales = () =>
  (supported ??= ExpoSpeechRecognitionModule.getSupportedLocales({}).then(
    (r) => r.locales,
    () => {
      supported = null;
      return [];
    },
  ));

// Apple's speech recognition as talk.ts takes it. Asking for the microphone and for recognition is part of
// starting: the first time, iOS shows its dialogs and this ends with not-allowed if either is refused.
// It ends at its end event, or at an error other than hearing nothing, after which iOS may send no end.
export const recognize: Recognize = (onText, onEnd, onStart) => {
  let ended = false;
  let started = false;
  const subs = [
    ExpoSpeechRecognitionModule.addListener('start', () => onStart()),
    ExpoSpeechRecognitionModule.addListener('result', (e) => onText(e.results[0]?.transcript ?? '')),
    ExpoSpeechRecognitionModule.addListener('error', (e) => e.error !== 'no-speech' && end(e.error)),
    ExpoSpeechRecognitionModule.addListener('end', () => end()),
  ];
  const end = (error?: string) => {
    if (ended) return;
    ended = true;
    for (const s of subs) s.remove();
    onEnd(error);
  };
  void supportedLocales().then((all) => {
    if (ended) return;
    const lang = hearLocale(getLocales(), all, speechLocale);
    if (!lang) return end('language-not-supported');
    started = true;
    ExpoSpeechRecognitionModule.start({ lang, interimResults: true, continuous: true, addsPunctuation: true });
  });
  // Let go before the locale is chosen: nothing was started, so nothing will say it ended.
  return {
    stop: () => (started ? ExpoSpeechRecognitionModule.stop() : end()),
    abort: () => (started ? ExpoSpeechRecognitionModule.abort() : end('aborted')),
  };
};
