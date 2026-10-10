import { describe, expect, it } from 'vitest';
import { createTextSize, TEXT_MAX } from '../../src/settings/textSize';
import { memoryStorage } from '../helpers/fakes';

describe('createTextSize', () => {
  it('reads a kept size only within its range, else the default', () => {
    expect(createTextSize(memoryStorage({ 'workoffdesk.textSize': '120' })).get()).toBe(120);
    expect(createTextSize(memoryStorage({ 'workoffdesk.textSize': String(TEXT_MAX + 10) })).get()).toBe(100);
    expect(createTextSize(memoryStorage({ 'workoffdesk.textSize': 'big' })).get()).toBe(100);
  });
});
