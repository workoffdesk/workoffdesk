import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CHAT_MIN, splitOf } from '../src/split.ts';

describe('splitOf', () => {
  // Every iPhone held upright, and a foldable's cover screen: one page at a time, as ever.
  for (const width of [320, 375, 390, 393, 402, 414, 428, 430, 440, 466, splitOf.from - 1]) {
    test(`keeps one page at a time at ${width}pt`, () => assert.equal(splitOf(width), null));
  }

  // A foldable opened, upright and on its side, and an iPad's widths.
  for (const width of [splitOf.from, 669, 744, 820, 951, 1024, 1366]) {
    test(`lists the sessions beside the page at ${width}pt, the page no narrower than a phone`, () => {
      const split = splitOf(width);
      assert.ok(split, 'split');
      assert.ok(split.list >= 280, `list ${split.list}`);
      assert.ok(width - split.list >= CHAT_MIN, `page ${width - split.list}`);
    });
  }

  test('gives the list the web app’s width once there is room for it', () => {
    assert.equal(splitOf(951)?.list, 320);
    assert.ok(splitOf(669).list < 320);
  });
});
