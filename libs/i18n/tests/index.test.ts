import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dictionaries, pickLang } from '../src/index';

describe('pickLang', () => {
  it.each([
    [['zh-CN'], 'zh'],
    [['zh-Hant-TW'], 'zh'],
    [['en-GB', 'zh-CN'], 'en'],
    [['fr-FR', 'zh-CN'], 'zh'],
    [['ja-JP'], 'en'],
    [[], 'en'],
  ])('a phone that puts %j first gets %s', (languages, lang) => {
    expect(pickLang(languages)).toBe(lang);
  });
});

const keys = (o: object) => Object.keys(o).sort();

describe('the dictionaries', () => {
  it('say the same things in each language', () => {
    const { en, zh } = dictionaries;
    expect(keys(zh)).toEqual(keys(en));
    for (const k of ['status', 'serverErrors', 'push', 'panelTitles', 'modes'] as const) expect(keys(zh[k])).toEqual(keys(en[k]));
  });

  // The server names by a code each error the phone shows; a code with no words for it would show raw English.
  it('have words for every error code the server sends', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
    const codes = new Set<string>();
    for (const f of files(join(__dirname, '../../../apps/server/src')))
      for (const m of readFileSync(f, 'utf8').matchAll(/new (?:Conflict|InvalidRequest|NotFound|UnsupportedMedia|NotAnImage)\(.*?,\s*'([a-z-]+)'\)/g)) codes.add(m[1]);
    expect(codes.size).toBeGreaterThan(0);
    for (const lang of ['en', 'zh'] as const) expect(keys(dictionaries[lang].serverErrors)).toEqual([...codes].sort());
  });
});
