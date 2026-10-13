import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
// Every `font-size: …` and `font: …` declaration, wherever it is.
const declarations = [...css.matchAll(/(?:^|[;{\s])(font(?:-size)?)\s*:\s*([^;}]+)/g)].map((m) => `${m[1]}: ${m[2].trim()}`);

describe('styles.css', () => {
  // The text size chosen in settings reaches every piece of text only if no size is fixed in pixels.
  describe('the text size', () => {
    it('finds the declarations it checks', () => {
      expect(declarations.length, 'precondition: the stylesheet has font declarations').toBeGreaterThan(30);
      expect(declarations.some((d) => d.includes('var(--text-scale)'))).toBe(true);
    });

    it('scales every size given in pixels', () => {
      const fixed = declarations.filter((d) => /\d(?:\.\d+)?px/.test(d) && !d.includes('var(--text-scale)'));
      expect(fixed).toEqual([]);
    });

    // Safari zooms the page into a field whose text is under 16px when it is tapped, at any text size.
    it('keeps the text of fields at 16px or more', () => {
      const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
      const fields = rules.filter((r) => /\b(input|textarea)\b|\.search\b/.test(r.selector) && /font(?:-size)?\s*:[^;]*\dpx/.test(r.body));
      expect(fields.length, 'precondition: the fields are found').toBeGreaterThanOrEqual(4);
      const unfloored = fields.filter((r) => !/font(?:-size)?\s*:\s*max\(16px,/.test(r.body)).map((r) => r.selector);
      expect(unfloored).toEqual([]);
    });

    it('is not set anywhere else in pixels', () => {
      const tsx = import.meta.glob('../../src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
      expect(Object.keys(tsx).length, 'precondition: the components were read').toBeGreaterThan(5);
      const inline = Object.entries(tsx).filter(([, src]) => /fontSize\s*:/.test(src)).map(([f]) => f);
      expect(inline).toEqual([]);
    });
  });
});

// A theme's value of a custom property, following var() through the blocks that theme reads, later ones winning.
const themeVar = (theme: 'dark' | 'light' | 'eye', name: string): string => {
  const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => {
      const selectors = m[1].split(',').map((s) => s.trim());
      return selectors.includes(':root') || (theme !== 'dark' && selectors.includes(`:root[data-theme='${theme}']`));
    })
    .map((m) => m[2]);
  expect(blocks.length, `precondition: the ${theme} theme is read`).toBe({ dark: 1, light: 2, eye: 3 }[theme]);
  const vars = new Map<string, string>();
  for (const body of blocks) for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) vars.set(m[1], m[2].trim());
  const resolve = (v: string): string => v.replace(/var\((--[\w-]+)\)/g, (_, n) => resolve(vars.get(n) ?? ''));
  return resolve(vars.get(name) ?? '');
};

describe("Claude's avatar", () => {
  const logo = readFileSync(new URL('../../public/icon.svg', import.meta.url), 'utf8').match(/<rect[^>]*fill="(#[0-9a-f]{6})"/i)?.[1];

  it.each(['dark', 'light'] as const)('is the blue of the logo in the %s theme', (theme) => {
    expect(logo, 'precondition: the logo has its blue').toMatch(/^#[0-9a-f]{6}$/i);
    expect(themeVar(theme, '--claude').toLowerCase()).toBe(logo?.toLowerCase());
  });
});

describe('a pinned row', () => {
  it.each(['dark', 'light', 'eye'] as const)('has a colour of its own, apart from a row\'s and a held one\'s (%s)', (theme) => {
    expect(themeVar(theme, '--row-held'), 'precondition: a held row is told apart').not.toBe(themeVar(theme, '--row'));
    expect(themeVar(theme, '--row-pinned')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(themeVar(theme, '--row-pinned')).not.toBe(themeVar(theme, '--row'));
    expect(themeVar(theme, '--row-pinned')).not.toBe(themeVar(theme, '--row-held'));
  });

  // As the row's own colour, so what is drawn on the row, held or open, stays as on any other.
  it('is drawn in it', () => {
    expect(css).toMatch(/\.sess-row\.pinned\s*\{\s*--row:\s*var\(--row-pinned\);\s*\}/);
    expect(css, 'precondition: a row is drawn in its own colour').toMatch(/\.sess-row > \.sess-item\s*\{[^}]*background:\s*var\(--row\)/);
  });
});

// The one rule of a selector, as its declarations.
const ruleOf = (selector: string) => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].trim() === selector).map((m) => m[2]);
  expect(bodies, `precondition: ${selector} has one rule`).toHaveLength(1);
  return Object.fromEntries([...bodies[0].matchAll(/([\w-]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()]));
};

describe("a session row's name and folder", () => {
  // A folder cut to a few letters names nothing and takes the name's room: where the two do not fit whole on
  // one line, the folder goes to a second line, which is not shown.
  it('shows the folder whole beside the name, or not at all', () => {
    const both = ruleOf('.sess-names');
    expect(both['flex-wrap']).toBe('wrap');
    expect(both.overflow).toBe('hidden');
    expect(both.height).toBe('1lh');
    const folder = ruleOf('.sess-dir');
    expect(folder.flex, 'the folder is never squeezed').toBe('none');
    expect(folder['max-width'], 'nor cut short').toBeUndefined();
  });

  it('gives the name the line once the folder is off it', () => {
    const name = ruleOf('.sess-name');
    expect(name.flex).toBe('1 1 auto');
    expect(name['min-width']).toBe('0');
  });
});
