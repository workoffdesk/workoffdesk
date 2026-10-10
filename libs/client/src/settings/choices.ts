import type { KeyValue } from '../base/platform';

// One of a few options, chosen on this device and kept in its storage; 'system' follows the device.
function createChoice<T extends string>(storage: KeyValue, key: string, options: readonly T[]) {
  const usual = options[0];
  return {
    options,
    get(): T {
      try {
        const v = storage.getItem(key);
        if (options.includes(v as T)) return v as T;
      } catch {
        // Storage can be blocked; following the device still works.
      }
      return usual;
    },
    keep(v: T): void {
      try {
        storage.setItem(key, v);
      } catch {
        // Not kept, but in effect until the app is closed.
      }
    },
  };
}

export const THEMES = ['system', 'light', 'dark', 'eye'] as const;
export type ThemeChoice = (typeof THEMES)[number];
export const createThemeChoice = (storage: KeyValue) => createChoice(storage, 'workoffdesk.theme', THEMES);

export const LANGUAGES = ['system', 'zh', 'en'] as const;
export type LanguageChoice = (typeof LANGUAGES)[number];
export const createLanguageChoice = (storage: KeyValue) => createChoice(storage, 'workoffdesk.language', LANGUAGES);
