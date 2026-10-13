import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync(new URL('../src/theme.ts', import.meta.url), 'utf8');
const block = (name) => source.match(new RegExp(`const ${name}[^{]*\\{([\\s\\S]*?)\\n\\};`))?.[1] ?? '';
const claude = (body) => body.match(/\bclaude:\s*'([^']+)'/)?.[1].toLowerCase();
const logo = readFileSync(new URL('../../web/public/icon.svg', import.meta.url), 'utf8')
  .match(/<rect[^>]*fill="(#[0-9a-f]{6})"/i)?.[1]
  .toLowerCase();

describe('theme', () => {
  test("draws Claude's avatar in the blue of the logo, dark and light", () => {
    assert.match(logo ?? '', /^#[0-9a-f]{6}$/, 'precondition: the logo has its blue');
    assert.equal(claude(block('dark')), logo);
    assert.match(block('light'), /\.\.\.dark/, 'precondition: the light theme starts from the dark');
    assert.equal(claude(block('light')) ?? claude(block('dark')), logo);
  });

  // A theme's colour, or the one it starts from: light from dark, eye from light.
  const colour = (theme, name) => {
    const value = block(theme).match(new RegExp(`\\b${name}:\\s*'([^']+)'`))?.[1].toLowerCase();
    return value ?? (theme === 'eye' ? colour('light', name) : theme === 'light' ? colour('dark', name) : undefined);
  };
  for (const theme of ['dark', 'light', 'eye']) {
    test(`marks a pinned row by a colour of its own, apart from a row's and a held one's (${theme})`, () => {
      assert.match(colour(theme, 'row') ?? '', /^#[0-9a-f]{6}$/, 'precondition: the row colour is read');
      assert.notEqual(colour(theme, 'rowHeld'), colour(theme, 'row'), 'precondition: a held row is told apart');
      const pinned = colour(theme, 'rowPinned');
      assert.match(pinned ?? '', /^#[0-9a-f]{6}$/);
      assert.notEqual(pinned, colour(theme, 'row'));
      assert.notEqual(pinned, colour(theme, 'rowHeld'));
    });
  }
});
