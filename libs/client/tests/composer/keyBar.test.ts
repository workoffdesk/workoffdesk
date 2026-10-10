import { describe, expect, it } from 'vitest';
import { createKeyBar } from '../../src/composer/keyBar';
import { brokenStorage, memoryStorage } from '../helpers/fakes';

describe('createKeyBar', () => {
  it('is hidden until asked for', () => {
    expect(createKeyBar(memoryStorage()).shown()).toBe(false);
  });

  it('is kept under the key the iPhone app already uses', () => {
    const storage = memoryStorage();
    createKeyBar(storage).show(true);
    expect(storage.data.get('workoffdesk.keysShown')).toBe('1');
    expect(createKeyBar(storage).shown()).toBe(true);
    createKeyBar(storage).show(false);
    expect(createKeyBar(storage).shown()).toBe(false);
  });

  it('is hidden without storage, and asking for it does not throw', () => {
    const bar = createKeyBar(brokenStorage);
    expect(bar.shown()).toBe(false);
    expect(() => bar.show(true)).not.toThrow();
  });
});
