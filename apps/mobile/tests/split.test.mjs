import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CHAT_MIN, splitOf } from '../src/split.ts';

describe('splitOf', () => {
  // Every iPhone upright, and a foldable's cover screen: one page at a time, as ever.
  for (const [width, height] of [
    [320, 568],
    [375, 667],
    [393, 852],
    [402, 874],
    [430, 932],
    [440, 956],
    [466, 678],
    [splitOf.from.width - 1, 1000],
  ]) {
    test(`keeps one page at a time at ${width}×${height}pt`, () => assert.equal(splitOf(width, height), null));
  }

  // Every iPhone on its side: wide, but too short for the list beside a chat and its keyboard.
  for (const [width, height] of [
    [568, 320],
    [844, 390],
    [874, 402],
    [932, 430],
    [956, 440],
    [1000, splitOf.from.height - 1],
  ]) {
    test(`keeps one page at a time on its side at ${width}×${height}pt`, () => assert.equal(splitOf(width, height), null));
  }

  // A foldable opened, upright and on its side, and an iPad's sizes both ways.
  for (const [width, height] of [
    [splitOf.from.width, splitOf.from.height],
    [669, 951],
    [951, 669],
    [744, 1133],
    [1133, 744],
    [820, 1180],
    [1366, 1024],
  ]) {
    test(`lists the sessions beside the page at ${width}×${height}pt, the page no narrower than a phone`, () => {
      const split = splitOf(width, height);
      assert.ok(split, 'split');
      assert.ok(split.list >= 280, `list ${split.list}`);
      assert.ok(width - split.list >= CHAT_MIN, `page ${width - split.list}`);
    });
  }

  test('gives the list the web app’s width once there is room for it', () => {
    assert.equal(splitOf(951, 669)?.list, 320);
    assert.ok(splitOf(669, 951).list < 320);
  });
});
