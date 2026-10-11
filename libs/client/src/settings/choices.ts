import type { KeyValue } from '../base/platform';

// One of a few options, chosen on this device and kept in its storage; the first is the usual one. What is chosen
// is in effect at once, for those that follow it too, and stays in effect until the app closes if storage is
// blocked.
function createChoice<T extends string>(storage: KeyValue, key: string, options: readonly T[]) {
  const usual = options[0];
  let chosen: T | null = null;
  const followers = new Set<(v: T) => void>();
  return {
    options,
    get(): T {
      if (chosen) return chosen;
      try {
        const v = storage.getItem(key);
        if (options.includes(v as T)) return v as T;
      } catch {
        // Storage can be blocked; the usual one still works.
      }
      return usual;
    },
    keep(v: T): void {
      chosen = v;
      try {
        storage.setItem(key, v);
      } catch {
        // Not kept, but in effect until the app is closed.
      }
      for (const f of followers) f(v);
    },
    follow(f: (v: T) => void): () => void {
      followers.add(f);
      return () => void followers.delete(f);
    },
  };
}

export const THEMES = ['system', 'light', 'dark', 'eye'] as const;
export type ThemeChoice = (typeof THEMES)[number];
export const createThemeChoice = (storage: KeyValue) => createChoice(storage, 'workoffdesk.theme', THEMES);

export const LANGUAGES = ['system', 'zh', 'en'] as const;
export type LanguageChoice = (typeof LANGUAGES)[number];
export const createLanguageChoice = (storage: KeyValue) => createChoice(storage, 'workoffdesk.language', LANGUAGES);

export const GROUPINGS = ['project', 'none'] as const;
export type GroupingChoice = (typeof GROUPINGS)[number];
// How the session list is shown: by git repository, or as one list.
export const createGroupingChoice = (storage: KeyValue) => createChoice(storage, 'workoffdesk.listGrouping', GROUPINGS);
