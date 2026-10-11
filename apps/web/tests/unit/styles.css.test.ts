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
const themeVar = (theme: 'dark' | 'light', name: string): string => {
  const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => {
      const selectors = m[1].split(',').map((s) => s.trim());
      return selectors.includes(':root') || (theme === 'light' && selectors.includes(":root[data-theme='light']"));
    })
    .map((m) => m[2]);
  expect(blocks.length, `precondition: the ${theme} theme is read`).toBe(theme === 'light' ? 2 : 1);
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
