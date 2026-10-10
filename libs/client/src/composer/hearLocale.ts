// A language the phone speaks, as iOS names it: zh-Hans-US is zh, Hans, US.
export type DeviceLocale = { languageCode: string | null; regionCode: string | null; languageScriptCode?: string | null };

// Where a language is heard when the phone's own region has no recognizer for it. Any other language is
// tried in the region named like it (fr-FR), then in the first region Apple has.
const HOME: Record<string, string> = { en: 'US', ja: 'JP', ko: 'KR', zh: 'CN', pt: 'BR', ar: 'SA', he: 'IL', hi: 'IN', sv: 'SE', da: 'DK', nb: 'NO', uk: 'UA', vi: 'VN', ms: 'MY', el: 'GR', cs: 'CZ', ca: 'ES' };
// Chinese written in traditional characters is heard as spoken in Taiwan.
const homeOf = (lang: string, script: string | null | undefined) => (lang === 'zh' && script === 'Hant' ? 'TW' : HOME[lang]);

function parse(tag: string): DeviceLocale {
  const [languageCode = null, ...rest] = tag.split(/[-_]/);
  return {
    languageCode,
    languageScriptCode: rest.find((p) => p.length === 4) ?? null,
    regionCode: rest.find((p) => p.length === 2 || /^\d{3}$/.test(p)) ?? null,
  };
}

// The locale to hear in: Apple's recognizer takes only a language-region it lists exactly, and a phone
// set to English in China is en-CN, which it does not. Each language the phone lists is tried in its own
// region, then where the language is at home; then the fallback the same way. Null when none of them is
// recognised. With no list to go by, the phone's own locale is all there is.
export function hearLocale(device: DeviceLocale[], supported: string[], fallback: string): string | null {
  if (!supported.length) return fallback;
  const has = new Set(supported);
  for (const l of [...device, parse(fallback)]) {
    const lang = l.languageCode;
    if (!lang) continue;
    const tries = [l.regionCode, homeOf(lang, l.languageScriptCode), lang.toUpperCase()].map((r) => r && `${lang}-${r}`);
    const found = tries.find((x) => x && has.has(x)) ?? supported.find((x) => x.startsWith(`${lang}-`));
    if (found) return found;
  }
  return null;
}
