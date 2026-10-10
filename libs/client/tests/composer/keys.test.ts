import { describe, expect, it } from 'vitest';
import { typedText } from '../../src/composer/keys';

describe('typedText', () => {
  it('sends text as one bracketed paste, with Enter after it as a keypress', () => {
    expect(typedText('hi\nthere', true, false)).toBe('\x1b[200~hi\nthere\x1b[201~\r');
    expect(typedText('a\x1b[201~b', false, false)).toBe('\x1b[200~ab\x1b[201~');
    expect(typedText('', true, false)).toBe('\r');
    expect(typedText('c', false, true)).toBe('c');
  });
});
