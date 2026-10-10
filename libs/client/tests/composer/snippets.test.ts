import { describe, expect, it } from 'vitest';
import { createSnippets, matchSnippets, SNIPPETS_KEY } from '../../src/composer/snippets';
import { brokenStorage, memoryStorage } from '../helpers/fakes';

describe('createSnippets and matchSnippets', () => {
  it('keeps them under workoffdesk.snippets', () => {
    expect(SNIPPETS_KEY).toBe('workoffdesk.snippets');
  });

  it('takes the non-empty lines of what was typed, trimmed', () => {
    const s = createSnippets(memoryStorage({ [SNIPPETS_KEY]: '  Continue \n\n\tRun lint\n   \nCommit' }));
    expect(s.lines()).toEqual(['Continue', 'Run lint', 'Commit']);
  });

  it('gives back the text as typed, blank lines and all, to edit again', () => {
    const store = memoryStorage();
    const s = createSnippets(store);
    s.set('a\n\n b ');
    expect(s.text()).toBe('a\n\n b ');
    expect(store.data.get(SNIPPETS_KEY)).toBe('a\n\n b ');
  });

  it('returns none when nothing was kept or storage is blocked', () => {
    expect(createSnippets(memoryStorage()).lines()).toEqual([]);
    const blocked = createSnippets(brokenStorage);
    expect(blocked.lines()).toEqual([]);
    expect(blocked.text()).toBe('');
    expect(() => blocked.set('x')).not.toThrow();
  });

  it('matches what was typed after the slash anywhere in the line, in any case', () => {
    expect(matchSnippets(['Continue', 'Run lint', 'commit it'], 'IN')).toEqual(['Continue', 'Run lint']);
    expect(matchSnippets(['a', 'b'], '')).toEqual(['a', 'b']);
  });
});
