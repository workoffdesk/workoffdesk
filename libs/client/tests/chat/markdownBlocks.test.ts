import { describe, expect, it } from 'vitest';
import { linkSpans, markdownBlocks, renderedText, spans } from '../../src/chat/markdownBlocks';

describe('spans', () => {
  it('reads code, bold, italic and links and leaves the rest as written', () => {
    expect(spans('run `pnpm test` **now** or *later*, see [docs](https://x.dev)')).toEqual([
      { text: 'run ' },
      { text: 'pnpm test', code: true },
      { text: ' ' },
      { text: 'now', bold: true },
      { text: ' or ' },
      { text: 'later', italic: true },
      { text: ', see ' },
      { text: 'docs', href: 'https://x.dev' },
    ]);
  });

  it('keeps marks inside code as they are', () => {
    expect(spans('`a **b** c`')).toEqual([{ text: 'a **b** c', code: true }]);
  });

  it('reads code inside bold', () => {
    expect(spans('**use `x`**')).toEqual([
      { text: 'use ', bold: true },
      { text: 'x', bold: true, code: true },
    ]);
  });

  it('does not take underscores in a name, or a lone star, for italics', () => {
    expect(spans('read snake_case_name and 2 * 3')).toEqual([{ text: 'read snake_case_name and 2 * 3' }]);
    expect(spans('__strong__ _soft_')).toEqual([{ text: 'strong', bold: true }, { text: ' ' }, { text: 'soft', italic: true }]);
  });

  it('leaves an unclosed mark as text', () => {
    expect(spans('a **b and `c')).toEqual([{ text: 'a **b and `c' }]);
  });

  describe('with addresses written out', () => {
    // GitHub's Markdown, which the web draws replies with, links an address written out as it is.
    it.each([
      ['see https://x.dev/a?b=1#c now', 'https://x.dev/a?b=1#c'],
      ['open http://localhost:5173/path', 'http://localhost:5173/path'],
      ['at www.example.com/docs', 'www.example.com/docs'],
    ])('links the address in %j', (line, url) => {
      const link = spans(line).find((sp) => sp.href !== undefined);
      expect(link).toEqual({ text: url, href: url.startsWith('www.') ? `http://${url}` : url });
    });

    it.each([
      ['ends a sentence: https://x.dev.', 'https://x.dev', '.'],
      ['(see https://x.dev/a)', 'https://x.dev/a', ')'],
      ['https://en.wikipedia.org/wiki/Foo_(bar), next', 'https://en.wikipedia.org/wiki/Foo_(bar)', ', next'],
      ['链接 https://x.dev/中文，然后', 'https://x.dev/中文', '，然后'],
      ['"https://x.dev/q"', 'https://x.dev/q', '"'],
    ])('leaves the punctuation after it out in %j', (line, url, after) => {
      const all = spans(line);
      const at = all.findIndex((sp) => sp.href !== undefined);
      expect(all[at]).toEqual({ text: url, href: url });
      expect(all[at + 1]?.text.startsWith(after)).toBe(true);
    });

    it('links an address in angle brackets and drops the brackets', () => {
      expect(spans('go <https://x.dev/a> now')).toEqual([{ text: 'go ' }, { text: 'https://x.dev/a', href: 'https://x.dev/a' }, { text: ' now' }]);
    });

    it('keeps the style around it', () => {
      expect(spans('**see https://x.dev**')).toEqual([
        { text: 'see ', bold: true },
        { text: 'https://x.dev', bold: true, href: 'https://x.dev' },
      ]);
    });

    it('does not link inside code, a written link, or a word that only looks like one', () => {
      expect(spans('`curl https://x.dev`')).toEqual([{ text: 'curl https://x.dev', code: true }]);
      expect(spans('[docs](https://x.dev)')).toEqual([{ text: 'docs', href: 'https://x.dev' }]);
      expect(spans('notahttps://x.dev and https:// and ftp://x.dev')).toEqual([{ text: 'notahttps://x.dev and https:// and ftp://x.dev' }]);
      expect(spans('see https://... or www.!')).toEqual([{ text: 'see https://... or www.!' }]);
    });
  });
});

describe('linkSpans', () => {
  it('finds the addresses in plain text and nothing else', () => {
    expect(linkSpans('**not bold** https://x.dev/a, `b`')).toEqual([
      { text: '**not bold** ' },
      { text: 'https://x.dev/a', href: 'https://x.dev/a' },
      { text: ', `b`' },
    ]);
    expect(linkSpans('no address')).toEqual([{ text: 'no address' }]);
  });
});

describe('markdownBlocks', () => {
  it('splits paragraphs on blank lines and keeps single line breaks', () => {
    expect(markdownBlocks('one\ntwo\n\nthree')).toEqual([
      { k: 'paragraph', spans: [{ text: 'one\ntwo' }] },
      { k: 'paragraph', spans: [{ text: 'three' }] },
    ]);
  });

  it('keeps fenced code whole, blank lines and marks included', () => {
    expect(markdownBlocks('Look:\n```ts\nconst a = 1;\n\n**b**\n```\nDone')).toEqual([
      { k: 'paragraph', spans: [{ text: 'Look:' }] },
      { k: 'code', lang: 'ts', text: 'const a = 1;\n\n**b**' },
      { k: 'paragraph', spans: [{ text: 'Done' }] },
    ]);
  });

  it('runs a code fence never closed to the end', () => {
    expect(markdownBlocks('```\nhalf')).toEqual([{ k: 'code', lang: '', text: 'half' }]);
  });

  it('reads headings, rules and quotes', () => {
    expect(markdownBlocks('## Plan\n---\n> careful\n> here')).toEqual([
      { k: 'heading', level: 2, spans: [{ text: 'Plan' }] },
      { k: 'rule' },
      { k: 'quote', spans: [{ text: 'careful\nhere' }] },
    ]);
  });

  it('reads bulleted and numbered lists with their nesting and continued lines', () => {
    expect(markdownBlocks('- a\n  - b\n- c\n  more\n\n3. x\n4. y')).toEqual([
      {
        k: 'list',
        items: [
          { depth: 0, marker: '•', spans: [{ text: 'a' }] },
          { depth: 1, marker: '•', spans: [{ text: 'b' }] },
          { depth: 0, marker: '•', spans: [{ text: 'c\nmore' }] },
        ],
      },
      {
        k: 'list',
        items: [
          { depth: 0, marker: '3.', spans: [{ text: 'x' }] },
          { depth: 0, marker: '4.', spans: [{ text: 'y' }] },
        ],
      },
    ]);
  });

  it('reads a table into rows of cells without its rule line', () => {
    expect(markdownBlocks('| a | b |\n|---|:-:|\n| `1` | 2 |')).toEqual([
      {
        k: 'table',
        rows: [
          [[{ text: 'a' }], [{ text: 'b' }]],
          [[{ text: '1', code: true }], [{ text: '2' }]],
        ],
      },
    ]);
  });

  it('returns nothing for nothing', () => {
    expect(markdownBlocks('')).toEqual([]);
    expect(markdownBlocks('\n\n')).toEqual([]);
  });
});

describe('renderedText', () => {
  it('drops the marks of bold, italic and inline code', () => {
    expect(renderedText('Tap the **login button**, then *wait* for `ok`.')).toBe('Tap the login button, then wait for ok.');
  });

  it('shows a link by its label and a bare address as it is', () => {
    expect(renderedText('See [LOGIN-42](https://x.dev/browse/LOGIN-42) or https://x.dev/a.')).toBe('See LOGIN-42 or https://x.dev/a.');
    expect(renderedText('Open <https://x.dev/b>')).toBe('Open https://x.dev/b');
  });

  it('gives a code block its contents without fences or language', () => {
    expect(renderedText('Run:\n\n```sh\npnpm test\npnpm lint\n```\n\nDone.')).toBe('Run:\n\npnpm test\npnpm lint\n\nDone.');
  });

  it('keeps the marks of a code block inside it', () => {
    expect(renderedText('```\n**not bold** [a](b)\n```')).toBe('**not bold** [a](b)');
  });

  it('marks list items with a bullet or their number, nested ones indented', () => {
    expect(renderedText('- one\n* two\n  - **inner**\n+ three')).toBe('• one\n• two\n  • inner\n• three');
    expect(renderedText('1. first\n2) second')).toBe('1. first\n2. second');
  });

  it('keeps a list item that runs over lines as one item', () => {
    expect(renderedText('- one\n  goes on')).toBe('• one\ngoes on');
  });

  it('drops the marks of headings and quotes', () => {
    expect(renderedText('## Plan\n\n> **note** this')).toBe('Plan\n\nnote this');
  });

  it('lays a table out row by row, cells apart by tabs, without its rule', () => {
    expect(renderedText('| a | **b** |\n|---|---|\n| 1 | [x](https://x.dev) |')).toBe('a\tb\n1\tx');
  });

  it('leaves a rule out', () => {
    expect(renderedText('above\n\n---\n\nbelow')).toBe('above\n\nbelow');
  });

  it('keeps the lines of a paragraph and what it does not read', () => {
    expect(renderedText('line one\nline two with a lone * and 3 < 4')).toBe('line one\nline two with a lone * and 3 < 4');
  });

  it('returns nothing for an empty reply', () => {
    expect(renderedText('')).toBe('');
  });
});
