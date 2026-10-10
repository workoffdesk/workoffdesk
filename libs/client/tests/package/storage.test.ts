import { describe, expect, it } from 'vitest';
import { createAnswers } from '../../src/chat/answered';
import { createDrafts } from '../../src/composer/drafts';
import { createSeen } from '../../src/sessions/seen';
import { createTextSize } from '../../src/settings/textSize';
import { brokenStorage, memoryStorage } from '../helpers/fakes';

const noChat = { view: () => ({ conv: null, items: [] }) };

describe('device storage', () => {
  it('keeps every key under the workoffdesk prefix', async () => {
    const s = memoryStorage();
    createSeen(s).markSeen('a');
    await createAnswers(s, noChat).give('a', async () => {}, 'Yes', 'Go?');
    createDrafts(s).keepDraft('a', 'half typed');
    createTextSize(s).keep(120);
    expect([...s.data.keys()].sort()).toEqual(['workoffdesk.answered.a', 'workoffdesk.draft.a', 'workoffdesk.seen', 'workoffdesk.textSize']);
  });

  it('reads back what was kept and does not keep an empty draft', () => {
    const s = memoryStorage();
    const drafts = createDrafts(s);
    drafts.keepDraft('a', 'x');
    expect(drafts.draftOf('a')).toBe('x');
    drafts.keepDraft('a', '');
    expect(s.data.has('workoffdesk.draft.a')).toBe(false);
    expect(createAnswers(s, noChat).answersOf('b')).toEqual([]);
  });

  it('works without storage, keeping nothing', async () => {
    expect(createSeen(brokenStorage).unreadOf([{ id: 'a', lastActivity: 1 }])).toEqual(new Set());
    expect(createDrafts(brokenStorage).draftOf('a')).toBe('');
    expect(createTextSize(brokenStorage).get()).toBe(100);
    await expect(createAnswers(brokenStorage, noChat).give('a', async () => {}, '', '')).resolves.toBeUndefined();
  });
});
