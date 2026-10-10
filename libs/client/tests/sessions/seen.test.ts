import { describe, expect, it } from 'vitest';
import { createSeen } from '../../src/sessions/seen';
import { memoryStorage } from '../helpers/fakes';

describe('createSeen', () => {
  it('counts a session as seen when first listed, and unread once active since', () => {
    const seen = createSeen(memoryStorage());
    expect(seen.unreadOf([{ id: 'a', lastActivity: 5 }])).toEqual(new Set());
    expect(seen.unreadOf([{ id: 'a', lastActivity: 6 }])).toEqual(new Set(['a']));
  });
});
