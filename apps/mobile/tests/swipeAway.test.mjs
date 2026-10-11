import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SWIPE_CLOSE_OFFSET, SWIPE_CLOSE_VELOCITY, swipeAway } from '../src/swipeAway.ts';

// A scroll view's offset is the opposite of where the picture in it was dragged: dragged down, it is negative.
const dragged = (x, y) => ({ x: -x, y: -y });
const still = { x: 0, y: 0 };
const round = (v) => v && { x: Math.round(v.x * 100) / 100 + 0, y: Math.round(v.y * 100) / 100 + 0 };
const far = SWIPE_CLOSE_OFFSET + 1;
const near = SWIPE_CLOSE_OFFSET / 3;

describe('a picture let go in the viewer', () => {
  for (const [what, x, y, way] of [
    ['down', 0, far, { x: 0, y: 1 }],
    ['up', 0, -far, { x: 0, y: -1 }],
    ['to the right', far, 0, { x: 1, y: 0 }],
    ['to the left', -far, 0, { x: -1, y: 0 }],
    ['down and to the left', -far, far, { x: -0.71, y: 0.71 }],
  ]) {
    test(`dragged far ${what} leaves that way`, () => assert.deepEqual(round(swipeAway(dragged(x, y), still)), way));
  }

  test('dragged a little and held still stays', () => {
    assert.equal(swipeAway(dragged(near, near), still), null);
    assert.equal(swipeAway(still, still), null);
  });

  test('flicked leaves the way it was dragged, however little', () => {
    const fast = SWIPE_CLOSE_VELOCITY * 1.5;
    assert.deepEqual(round(swipeAway(dragged(near, 0), { x: -fast, y: 0 })), { x: 1, y: 0 });
    assert.deepEqual(round(swipeAway(dragged(0, near), { x: 0, y: -fast })), { x: 0, y: 1 });
  });

  test('flicked from where it was, leaves the way it was flicked', () => {
    assert.deepEqual(round(swipeAway(still, { x: 0, y: -SWIPE_CLOSE_VELOCITY * 1.5 })), { x: 0, y: 1 });
  });

  test('let go slower than a flick stays', () => {
    assert.equal(swipeAway(dragged(near, 0), { x: -SWIPE_CLOSE_VELOCITY / 2, y: 0 }), null);
  });
});
