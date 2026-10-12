import { describe, expect, it } from 'vitest';
import { ACTION_PX, gestureOf, rowShift, staysOpen, SWIPE_PX } from '../../src/sessions/rowSwipe';

const width = 2 * ACTION_PX;

describe('gestureOf', () => {
  it.each<[string, number, number, ReturnType<typeof gestureOf>]>([
    ['still', 0, 0, null],
    ['moved less than a swipe, any way', SWIPE_PX - 1, -(SWIPE_PX - 1), null],
    ['to the left', -SWIPE_PX, 0, 'swipe'],
    ['to the right, to close it', SWIPE_PX, 2, 'swipe'],
    ['up', 1, -SWIPE_PX, 'scroll'],
    ['down', 0, SWIPE_PX, 'scroll'],
    ['as far across as down', SWIPE_PX, SWIPE_PX, 'scroll'],
  ])('tells a finger moved %s', (_, mx, my, gesture) => {
    expect(gestureOf(mx, my)).toBe(gesture);
  });
});

describe('rowShift', () => {
  it.each<[string, boolean, number, number]>([
    ['a shut row follows the finger left', false, -40, -40],
    ['a shut row goes no further right', false, 30, 0],
    ['nor further left than its actions', false, -500, -width],
    ['an open row follows the finger right from open', true, 40, -width + 40],
    ['and goes no further left', true, -40, -width],
    ['nor further right than shut', true, 500, 0],
  ])('%s', (_, open, mx, shift) => {
    expect(rowShift(open, width, mx)).toBe(shift);
  });
});

describe('staysOpen', () => {
  it.each<[string, number, boolean]>([
    ['let go past half its actions', -width / 2 - 1, true],
    ['let go at half', -width / 2, false],
    ['let go short of half', -10, false],
    ['let go shut', 0, false],
  ])('a shut row %s', (_, shift, open) => {
    expect(staysOpen(false, shift, width)).toBe(open);
  });

  it.each<[string, number, boolean]>([
    ['let go short of half its actions back', -width / 2 - 1, true],
    ['let go at half', -width / 2, false],
    ['let go open', -width, true],
  ])('an open row %s', (_, shift, open) => {
    expect(staysOpen(true, shift, width)).toBe(open);
  });

  // However many actions it has, a row opens and shuts as far along as one with two does.
  const three = 3 * ACTION_PX;
  it.each<[string, number, boolean, number, boolean]>([
    ['one action, opened past half of it', ACTION_PX, false, -ACTION_PX / 2 - 1, true],
    ['three actions, opened past one', three, false, -ACTION_PX - 1, true],
    ['three actions, opened as far as one', three, false, -ACTION_PX, false],
    ['three actions, shut short of one', three, true, -three + ACTION_PX - 1, true],
    ['three actions, shut as far as one', three, true, -three + ACTION_PX, false],
  ])('a row with %s', (_, wide, was, shift, open) => {
    expect(staysOpen(was, shift, wide)).toBe(open);
  });
});
