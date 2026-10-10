// The phone's words, for the web app and the mobile app alike: Chinese when the phone prefers it, English
// otherwise. What the server reads off Claude Code's screen stays in Claude Code's own words and is not here.

import { en, type Dict } from './en';
import { zh } from './zh';

export type { Dict };

export type Lang = 'en' | 'zh';

export function pickLang(languages: readonly string[]): Lang {
  for (const l of languages) {
    if (/^zh\b/i.test(l)) return 'zh';
    if (/^en\b/i.test(l)) return 'en';
  }
  return 'en';
}

// A browser lists the phone's languages in order; React Native has no such list, and its Intl knows the first.
const languages: readonly string[] = globalThis.navigator?.languages ?? [Intl.DateTimeFormat().resolvedOptions().locale];
// A language chosen in the app's settings rather than the phone's: the app's entry puts it here before this
// module loads, since every word below is picked as it loads.
const chosen: unknown = (globalThis as { workoffdeskLanguage?: unknown }).workoffdeskLanguage;
export const lang: Lang = chosen === 'zh' || chosen === 'en' ? chosen : pickLang(languages);
// What the phone hears and reads aloud in: the language it puts first, which the interface may not have.
export const speechLocale = languages[0] ?? (lang === 'zh' ? 'zh-CN' : 'en-US');
export const t: Dict = lang === 'zh' ? zh : en;
export const dictionaries: Record<Lang, Dict> = { en, zh };
