import { describe, expect, it } from 'vitest';
import { nodeTooOld } from '../../../src/system/node.js';

describe('nodeTooOld', () => {
  it.each<[string, boolean]>([
    ['20.19.0', true],
    ['22.12.9', true],
    ['22.13.0', false],
    ['22.20.1', false],
    ['23.0.0', false],
    ['24.14.0', false],
  ])('tells whether node %s is too old: %s', (version, old) => {
    expect(nodeTooOld(version)).toBe(old);
  });
});
