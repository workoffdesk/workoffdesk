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
});
