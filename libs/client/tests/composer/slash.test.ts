import { describe, expect, it } from 'vitest';
import { matchCommands, type SlashCommand, slashQuery, withMention } from '../../src/composer/slash';

describe('slashQuery', () => {
  it.each([
    ['/', ''],
    ['/com', 'com'],
    ['/superpowers:bra', 'superpowers:bra'],
    ['/Com', 'Com'],
  ])('asks for commands while %j is a slash and the start of one name', (text, query) => {
    expect(slashQuery(text)).toBe(query);
  });

  it.each([
    ['nothing typed', ''],
    ['words', '帮我看看'],
    ['a / later on', '看 /tmp/a.png'],
    ['a name already taken, with its argument started', '/compact '],
    ['a second line', '/compact\nmore'],
    ['a space first', ' /compact'],
    ['a path', '/Users/me'],
  ])('asks for none with %s', (_, text) => {
    expect(slashQuery(text)).toBeNull();
  });
});

const c = (name: string): SlashCommand => ({ name, description: name, source: 'user' });
const all = ['clear', 'compact', 'config', 'context', 'pen-ui', 'superpowers:brainstorming', 'superpowers:writing-plans', 'gstack-plan'].map(c);
const names = (q: string) => matchCommands(all, q).map((x) => x.name);

describe('matchCommands', () => {
  it('lists every command for a bare slash', () => {
    expect(names('')).toEqual(all.map((x) => x.name));
  });

  it('ranks names starting with the query first, then a part after a colon, then anywhere', () => {
    expect(names('co')).toEqual(['compact', 'config', 'context']);
    expect(names('bra')).toEqual(['superpowers:brainstorming']);
    expect(names('plan')).toEqual(['superpowers:writing-plans', 'gstack-plan']);
    expect(names('wri')).toEqual(['superpowers:writing-plans']);
  });

  it('ranks a part after a colon starting with the query above a name merely containing it', () => {
    const list = ['gstack-review', 'pr:review'].map(c);
    expect(matchCommands(list, 'rev').map((x) => x.name)).toEqual(['pr:review', 'gstack-review']);
  });

  it('ignores case', () => {
    expect(names('CL')).toEqual(['clear']);
  });

  it('returns nothing when nothing matches', () => {
    expect(names('zzz')).toEqual([]);
  });
});

describe('withMention', () => {
  it.each([
    ['at the end of the text', 'look at @sr', 11, 8, 'look at @src/app.ts ', 20],
    ['with the rest of the word after the caret', 'look at @srxyz please', 11, 8, 'look at @src/app.ts please', 20],
    ['with a space already after the word', 'look at @sr and that', 11, 8, 'look at @src/app.ts and that', 20],
    ['at the very start', '@', 1, 0, '@src/app.ts ', 12],
    ['with the caret right after the @', '@ then', 1, 0, '@src/app.ts then', 12],
  ])('completes the @ being typed to the whole path %s, one space and the caret after it', (_, text, caret, start, out, outCaret) => {
    expect(withMention(text, caret, { start }, 'src/app.ts')).toEqual({ text: out, caret: outCaret });
  });

  it('reuses a space already after the word and leaves the other mentions alone', () => {
    expect(withMention('@sr   x', 3, { start: 0 }, 'src/a.ts').text).toBe('@src/a.ts   x');
  });

  it('puts the caret right after the space it adds', () => {
    const r = withMention('see @a', 6, { start: 4 }, 'a b.txt');
    expect(r.text.slice(0, r.caret)).toBe('see @a b.txt ');
  });
});
