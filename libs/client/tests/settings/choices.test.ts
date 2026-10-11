import { describe, expect, it } from 'vitest';
import { createGroupingChoice, createLanguageChoice, createThemeChoice, GROUPINGS, LANGUAGES, THEMES } from '../../src/settings/choices';
import type { KeyValue } from '../../src/base/platform';
import { brokenStorage, memoryStorage } from '../helpers/fakes';

type Choice = { get(): string; keep(v: string): void };

describe.each<[string, (storage: KeyValue) => Choice, string, readonly string[], string, string]>([
  ['theme', createThemeChoice, 'workoffdesk.theme', THEMES, 'eye', 'system'],
  ['language', createLanguageChoice, 'workoffdesk.language', LANGUAGES, 'zh', 'system'],
  ['list grouping', createGroupingChoice, 'workoffdesk.listGrouping', GROUPINGS, 'none', 'project'],
])('the %s choice', (_, create, key, options, other, usual) => {
  it('is the usual one until one is chosen', () => {
    expect(create(memoryStorage()).get()).toBe(usual);
  });

  it('keeps the chosen one from one start of the app to the next', () => {
    const storage = memoryStorage();
    create(storage).keep(other);
    expect(storage.data.get(key)).toBe(other);
    expect(create(storage).get()).toBe(other);
  });

  it.each(['', 'System', 'blue', 'eye '])('is the usual one when what is kept is not one of its options: %j', (kept) => {
    expect(options).not.toContain(kept);
    expect(create(memoryStorage({ [key]: kept })).get()).toBe(usual);
  });

  it('is the usual one, and choosing still works, when storage is blocked', () => {
    const c = create(brokenStorage);
    expect(c.get()).toBe(usual);
    expect(() => c.keep(other)).not.toThrow();
  });
});

describe('createThemeChoice and createLanguageChoice', () => {
  it('keeps the theme and the language apart', () => {
    const storage = memoryStorage();
    createThemeChoice(storage).keep('dark');
    expect(createLanguageChoice(storage).get()).toBe('system');
  });
});

describe('a choice followed', () => {
  it('tells who follows it of each choice made, until they stop', () => {
    const c = createGroupingChoice(memoryStorage());
    const heard: string[] = [];
    const stop = c.follow((v) => heard.push(v));
    c.keep('none');
    c.keep('project');
    stop();
    c.keep('none');
    expect(heard).toEqual(['none', 'project']);
  });

  it('is told even when storage is blocked: the choice is in effect until the app closes', () => {
    const c = createGroupingChoice(brokenStorage);
    const heard: string[] = [];
    c.follow((v) => heard.push(v));
    c.keep('none');
    expect(heard).toEqual(['none']);
    expect(c.get()).toBe('none');
  });
});
