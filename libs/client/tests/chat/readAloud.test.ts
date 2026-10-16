import { describe, expect, it } from 'vitest';
import { bestVoice, type SpokenVoice } from '../../src/chat/readAloud';

// As iOS lists them to the app, and Safari to the web app: the quality is in the identifier, since the app's
// own quality field calls a premium voice Default.
const compact: SpokenVoice = { id: 'com.apple.voice.compact.zh-CN.Tingting', name: 'Tingting', lang: 'zh-CN' };
const enhanced: SpokenVoice = { id: 'com.apple.voice.enhanced.zh-CN.Tingting', name: 'Tingting (Enhanced)', lang: 'zh-CN' };
const premium: SpokenVoice = { id: 'com.apple.voice.premium.zh-CN.Lili', name: 'Lili (Premium)', lang: 'zh-CN' };
const taiwan: SpokenVoice = { id: 'com.apple.voice.premium.zh-TW.Meijia', name: 'Meijia (Premium)', lang: 'zh-TW' };
const english: SpokenVoice = { id: 'com.apple.voice.premium.en-US.Zoe', name: 'Zoe (Premium)', lang: 'en-US' };

describe('bestVoice', () => {
  it.each([
    ['a premium voice over an enhanced one', [compact, enhanced, premium], 'zh-CN', premium.id],
    ['an enhanced voice over the compact one', [compact, enhanced], 'zh-CN', enhanced.id],
    ['one the platform calls enhanced', [compact, { ...compact, id: 'x.zh', enhanced: true }], 'zh-CN', 'x.zh'],
    ['one named enhanced, as a browser lists it', [compact, { id: 'Tingting', name: 'Tingting (Enhanced)', lang: 'zh_CN' }], 'zh-CN', 'Tingting'],
    ['the region of a locale written with its script', [compact, enhanced], 'zh-Hans-CN', enhanced.id],
    ['any region when the locale names none', [compact, taiwan], 'zh', taiwan.id],
  ])('picks %s', (_, voices, locale, id) => {
    expect(bestVoice(voices, locale)).toBe(id);
  });

  it.each([
    ['only compact voices', [compact], 'zh-CN'],
    ['no voices yet', [], 'zh-CN'],
    ['a better voice only in another region', [compact, taiwan], 'zh-CN'],
    ['a better voice only in another language', [compact, english], 'zh-CN'],
    ['a voice whose language starts the same way', [{ ...premium, lang: 'zha-CN' }], 'zh-CN'],
  ])('leaves the system its own voice with %s', (_, voices, locale) => {
    expect(bestVoice(voices, locale)).toBeUndefined();
  });
});
