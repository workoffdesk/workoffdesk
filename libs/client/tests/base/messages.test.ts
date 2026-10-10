import { describe, expect, it } from 'vitest';
import { messageId } from '../../src/base/messages';

describe('messageId', () => {
  it('makes an id the server accepts', () => {
    expect(messageId(new Uint8Array([0, 255, 16, 1, 2, 3, 4, 5]))).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});
