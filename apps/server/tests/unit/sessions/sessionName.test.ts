import { describe, expect, it } from 'vitest';
import { idOfTmuxName, tmuxName } from '../../../src/sessions/sessionName.js';

describe('tmuxName and idOfTmuxName', () => {
  it('names a session wod-<id>', () => {
    expect(tmuxName('abc12345')).toBe('wod-abc12345');
  });

  it('reads the id back from its own names only', () => {
    expect(idOfTmuxName('wod-abc12345')).toBe('abc12345');
    expect(idOfTmuxName('ts-abc12345')).toBeUndefined();
    expect(idOfTmuxName('main')).toBeUndefined();
    expect(idOfTmuxName('xwod-abc')).toBeUndefined();
  });
});
