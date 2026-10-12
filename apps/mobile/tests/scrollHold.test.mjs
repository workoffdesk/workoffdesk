import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { scrollHolds } from '../src/scrollHold.ts';

const watched = () => {
  const said = [];
  return { said, hold: scrollHolds((held) => said.push(held)) };
};

describe('a list held still while a row is slid', () => {
  test('is held from the first hold until it is let go', () => {
    const { said, hold } = watched();
    const letGo = hold();
    assert.deepEqual(said, [true]);
    letGo();
    assert.deepEqual(said, [true, false]);
  });

  test('stays held until every hold is let go, in any order', () => {
    const { said, hold } = watched();
    const a = hold();
    const b = hold();
    a();
    assert.deepEqual(said, [true]);
    b();
    assert.deepEqual(said, [true, false]);
  });

  test('a hold let go twice, as a row let go and then gone, lets go once', () => {
    const { said, hold } = watched();
    const a = hold();
    const b = hold();
    a();
    a();
    assert.deepEqual(said, [true], 'b still holds it');
    b();
    assert.deepEqual(said, [true, false]);
  });

  test('is held again by a new hold after all were let go', () => {
    const { said, hold } = watched();
    hold()();
    hold();
    assert.deepEqual(said, [true, false, true]);
  });
});
