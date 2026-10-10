import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { openSessionFromOutside } from '../src/openSession.ts';

// A stack as expo-router keeps it, by path: the list at the bottom, the page in front last.
const stack = (...paths) => {
  const s = ['/', ...paths];
  return {
    paths: s,
    here: () => s.at(-1),
    canDismiss: () => s.length > 1,
    dismissAll: () => void s.splice(1),
    push: (href) => void s.push(`/session/${href.params.id}`),
  };
};

describe('openSessionFromOutside', () => {
  for (const [what, under] of [
    ['from the list', []],
    ['from another session', ['/session/a']],
    ['from a session opened over another', ['/session/a', '/session/c']],
    ['from settings', ['/settings', '/mac']],
    ['from the new-session sheet', ['/new-session']],
    ['from a conversation on the Mac', ['/claude/3f2a1b4c']],
  ]) {
    test(`leaves the session over the list alone, ${what}`, () => {
      const s = stack(...under);
      openSessionFromOutside(s, 'b');
      assert.deepEqual(s.paths, ['/', '/session/b']);
    });
  }

  test('moves nothing when the session is the one in front', () => {
    const s = stack('/session/a', '/session/b');
    openSessionFromOutside(s, 'b');
    assert.deepEqual(s.paths, ['/', '/session/a', '/session/b']);
  });
});
