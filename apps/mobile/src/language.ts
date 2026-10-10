import { createLanguageChoice } from '@workoffdesk/client/settings/choices';
import Storage from 'expo-sqlite/kv-store';

// The language chosen in Settings, handed to @workoffdesk/i18n before anything loads it (see index.ts): its
// words are picked once, as it loads, so a new choice takes the app reopening.
export const languageChoice = createLanguageChoice({
  getItem: (k) => Storage.getItemSync(k),
  setItem: (k, v) => Storage.setItemSync(k, v),
  removeItem: (k) => void Storage.removeItemSync(k),
});

const chosen = languageChoice.get();
if (chosen !== 'system') (globalThis as { workoffdeskLanguage?: string }).workoffdeskLanguage = chosen;
