import type { KeyValue } from '../base/platform';

// What was typed in a session's composer and not sent, kept on this device so it is there after the
// session is left or the app reloaded. Without storage nothing is kept.
const KEY = 'workoffdesk.draft.';

export function createDrafts(storage: KeyValue) {
  return {
    draftOf(key: string): string {
      try {
        return storage.getItem(KEY + key) ?? '';
      } catch {
        return '';
      }
    },
    keepDraft(key: string, text: string): void {
      try {
        if (text) storage.setItem(KEY + key, text);
        else storage.removeItem(KEY + key);
      } catch {
        // Not kept.
      }
    },
  };
}
