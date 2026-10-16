// A voice the phone or browser can read a reply in. The quality is told by the id or name too, since iOS hands
// the app a premium voice as Default.
export type SpokenVoice = { id: string; name: string; lang: string; enhanced?: boolean };

// The language and region of a locale such as zh-Hans-CN or zh_CN; a script is not a region.
function place(locale: string): { language: string; region?: string } {
  const [language = '', ...rest] = locale.toLowerCase().split(/[-_]/);
  return { language, region: rest.find((part) => /^([a-z]{2}|\d{3})$/.test(part)) };
}

function quality(v: SpokenVoice): number {
  const said = `${v.id} ${v.name}`;
  if (/premium/i.test(said)) return 2;
  if (v.enhanced || /enhanced/i.test(said)) return 1;
  return 0;
}

// The best sounding voice there is for the locale, or none to leave the system its own: a voice of another
// region would read the reply in another accent, and one no better than the system's gains nothing.
export function bestVoice(voices: readonly SpokenVoice[], locale: string): string | undefined {
  const want = place(locale);
  let best: SpokenVoice | undefined;
  for (const v of voices) {
    const has = place(v.lang);
    if (has.language !== want.language || (want.region && has.region !== want.region)) continue;
    if (quality(v) > (best ? quality(best) : 0)) best = v;
  }
  return best?.id;
}
