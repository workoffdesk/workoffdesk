import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { watchReload } from '../src/reloadWatch.ts';

const WAIT = 5000;

describe('asking the app to start again', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  test('says it did not, with why, once refused', async () => {
    const stuck = mock.fn();
    watchReload(() => Promise.reject(new Error('no update to launch')), WAIT, stuck);
    await new Promise(setImmediate);
    assert.deepEqual(stuck.mock.calls.map((c) => c.arguments), [['no update to launch']]);
    mock.timers.tick(WAIT * 2);
    assert.equal(stuck.mock.callCount(), 1);
  });

  for (const [what, reload] of [
    ['never answered', () => new Promise(() => {})],
    ['answered without starting again', () => Promise.resolve()],
  ]) {
    test(`says it did not, once ${what} for a while`, async () => {
        const stuck = mock.fn();
      watchReload(reload, WAIT, stuck);
      await new Promise(setImmediate);
      mock.timers.tick(WAIT - 1);
      assert.equal(stuck.mock.callCount(), 0);
      mock.timers.tick(1);
      assert.deepEqual(stuck.mock.calls.map((c) => c.arguments), [[null]]);
      });
  }

  test('says it once, however late a refusal comes', async () => {
    const stuck = mock.fn();
    let refuse;
    watchReload(() => new Promise((_, no) => (refuse = no)), WAIT, stuck);
    mock.timers.tick(WAIT);
    refuse(new Error('late'));
    await new Promise(setImmediate);
    assert.deepEqual(stuck.mock.calls.map((c) => c.arguments), [[null]]);
  });
});
