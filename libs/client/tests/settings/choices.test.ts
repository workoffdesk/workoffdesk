import { describe, expect, it } from 'vitest';
import { createLanguageChoice, createThemeChoice, LANGUAGES, THEMES } from '../../src/settings/choices';
import type { KeyValue } from '../../src/base/platform';
import { brokenStorage, memoryStorage } from '../helpers/fakes';

type Choice = { get(): string; keep(v: string): void };

describe.each<[string, (storage: KeyValue) => Choice, string, readonly string[], string]>([
  ['theme', createThemeChoice, 'workoffdesk.theme', THEMES, 'eye'],
  ['language', createLanguageChoice, 'workoffdesk.language', LANGUAGES, 'zh'],
])('the %s choice', (_, create, key, options, other) => {
  it('follows the device until one is chosen', () => {
    expect(create(memoryStorage()).get()).toBe('system');
  });

  it('keeps the chosen one from one start of the app to the next', () => {
    const storage = memoryStorage();
    create(storage).keep(other);
    expect(storage.data.get(key)).toBe(other);
    expect(create(storage).get()).toBe(other);
  });

  it.each(['', 'System', 'blue', 'eye '])('follows the device when what is kept is not one of its options: %j', (kept) => {
    expect(options).not.toContain(kept);
    expect(create(memoryStorage({ [key]: kept })).get()).toBe('system');
  });

  it('follows the device, and choosing still works, when storage is blocked', () => {
    const c = create(brokenStorage);
    expect(c.get()).toBe('system');
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
