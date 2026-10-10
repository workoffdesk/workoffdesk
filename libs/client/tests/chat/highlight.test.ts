import { describe, expect, it } from 'vitest';
import { codeTokens, highlightHtml } from '../../src/chat/highlight';

describe('codeTokens and highlightHtml', () => {
  it('splits code into runs of text, each with its kind', () => {
    const runs = codeTokens('const a = "x"; // note', 'ts');
    expect(runs.map((r) => r.text).join('')).toBe('const a = "x"; // note');
    expect(runs).toContainEqual({ text: 'const', kind: 'keyword' });
    expect(runs).toContainEqual({ text: '"x"', kind: 'string' });
    expect(runs).toContainEqual({ text: '// note', kind: 'comment' });
  });

  it('gives back the text exactly, entities and nested spans included', () => {
    const code = 'if (a < b && c > d) { return "<&>"; }\n  fn(1)';
    expect(codeTokens(code, 'js').map((r) => r.text).join('')).toBe(code);
    expect(codeTokens(code, '').map((r) => r.text).join('')).toBe(code);
  });

  it('marks the lines of a diff', () => {
    const runs = codeTokens('-old\n+new', 'diff');
    expect(runs).toContainEqual({ text: '-old', kind: 'deletion' });
    expect(runs).toContainEqual({ text: '+new', kind: 'addition' });
  });

  it('guesses the language when none is named and keeps HTML out of the guesses', () => {
    expect(highlightHtml('<script>x</script>', 'nope')).not.toContain('<script>');
  });
});
