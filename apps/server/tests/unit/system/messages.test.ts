import { describe, expect, it } from 'vitest';
import { en, m, messagesFor, pickLang, systemLanguages, zh } from '../../../src/system/messages.js';

describe('pickLang', () => {
  it.each([
    [['zh-CN'], 'zh'],
    [['zh-Hant-TW', 'en-US'], 'zh'],
    [['en-GB', 'zh-CN'], 'en'],
    [['fr-FR', 'zh-CN'], 'zh'],
    [['fr-FR', 'de-DE'], 'en'],
    [['ZH-tw'], 'zh'],
    [['zhx'], 'en'],
    [[], 'en'],
  ] as const)('%j → %s', (languages, lang) => {
    expect(pickLang(languages)).toBe(lang);
  });
});

describe('systemLanguages', () => {
  it('turns a POSIX locale into a language tag', () => {
    expect(systemLanguages({ LANG: 'zh_CN.UTF-8' })).toEqual(['zh-CN']);
    expect(systemLanguages({ LANG: 'en_US.UTF-8@euro' })).toEqual(['en-US']);
  });

  it('takes LC_ALL over LC_MESSAGES over LANG', () => {
    expect(systemLanguages({ LC_ALL: 'en_US.UTF-8', LC_MESSAGES: 'zh_CN.UTF-8', LANG: 'zh_CN.UTF-8' })).toEqual(['en-US']);
    expect(systemLanguages({ LC_MESSAGES: 'zh_TW.UTF-8', LANG: 'en_US.UTF-8' })).toEqual(['zh-TW']);
  });

  it.each(['C', 'POSIX', 'C.UTF-8', ''])('passes over %j to the next variable', (none) => {
    expect(systemLanguages({ LC_ALL: none, LANG: 'zh_CN.UTF-8' })).toEqual(['zh-CN']);
  });

  it("falls back to the runtime's own locale when no variable names one", () => {
    expect(systemLanguages({ LC_ALL: 'C' })).toEqual([Intl.DateTimeFormat().resolvedOptions().locale]);
  });
});

describe('en and zh', () => {
  const shape = (o: object): unknown =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'function' ? `fn/${v.length}` : typeof v === 'object' ? shape(v) : typeof v]));

  it('gives zh the same keys as en, with the same parameters', () => {
    expect(Object.keys(en).length).toBeGreaterThan(0);
    expect(shape(zh)).toEqual(shape(en));
  });
});

describe('messagesFor', () => {
  it('picks the dictionary by language', () => {
    expect(messagesFor(['zh-CN'])).toBe(zh);
    expect(messagesFor(['en-US'])).toBe(en);
    expect(messagesFor(['ja-JP'])).toBe(en);
  });
});

describe('m', () => {
  it('speaks English under the test setup, whatever this machine speaks', () => {
    expect(m).toBe(en);
  });
});
