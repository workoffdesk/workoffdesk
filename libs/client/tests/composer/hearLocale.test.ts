import { describe, expect, it } from 'vitest';
import { hearLocale, type DeviceLocale } from '../../src/composer/hearLocale';

// What SFSpeechRecognizer.supportedLocales() names on iOS 26 (a part of it).
const IOS = ['en-AU', 'en-CA', 'en-GB', 'en-IN', 'en-US', 'fr-CA', 'fr-FR', 'ja-JP', 'ko-KR', 'yue-CN', 'zh-CN', 'zh-HK', 'zh-TW'];
const at = (languageCode: string, regionCode: string | null, languageScriptCode: string | null = null): DeviceLocale => ({
  languageCode,
  regionCode,
  languageScriptCode,
});

describe('hearLocale', () => {
  it.each([
    ['English in China', [at('en', 'CN')], 'en-US'],
    ['Simplified Chinese in the US', [at('zh', 'US', 'Hans')], 'zh-CN'],
    ['Traditional Chinese in the US', [at('zh', 'US', 'Hant')], 'zh-TW'],
    ['Japanese in Japan', [at('ja', 'JP')], 'ja-JP'],
    ['British English', [at('en', 'GB')], 'en-GB'],
    ['Chinese in Hong Kong', [at('zh', 'HK', 'Hant')], 'zh-HK'],
    ['French in Belgium', [at('fr', 'BE')], 'fr-FR'],
    ['no region', [at('ko', null)], 'ko-KR'],
    ['Cantonese in Hong Kong, heard where Apple has it', [at('yue', 'HK', 'Hant')], 'yue-CN'],
  ])('maps %s to a language Apple recognises', (_, device, heard) => {
    expect(hearLocale(device, IOS, 'en-CN')).toBe(heard);
  });

  it('takes the next language the phone lists when the first is not recognised at all', () => {
    expect(hearLocale([at('xx', 'YY'), at('zh', 'CN', 'Hans')], IOS, 'xx-YY')).toBe('zh-CN');
  });

  it('falls back to the given locale, made one Apple recognises', () => {
    expect(hearLocale([at('xx', 'YY')], IOS, 'en-CN')).toBe('en-US');
    expect(hearLocale([], IOS, 'ja-JP')).toBe('ja-JP');
  });

  it('returns null when nothing the phone speaks is recognised, so nothing is started that cannot work', () => {
    expect(hearLocale([at('xx', 'YY')], IOS, 'xx-YY')).toBeNull();
  });

  it("starts from the phone's own locale when the list could not be read", () => {
    expect(hearLocale([at('en', 'CN')], [], 'en-CN')).toBe('en-CN');
  });
});
