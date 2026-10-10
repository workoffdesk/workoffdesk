import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(__dirname, '../../../scripts/npm-docs.mjs');
const root = join(__dirname, '../../../../..');
const BLOB = 'https://github.com/workoffdesk/workoffdesk/blob/main/';
const RAW = 'https://raw.githubusercontent.com/workoffdesk/workoffdesk/main/';

// Copies `files` from the repository root into a fresh folder, as the package ships them.
const copy = (files: Record<string, string>) => {
  const from = mkdtempSync(join(tmpdir(), 'npm-docs-from-'));
  const to = mkdtempSync(join(tmpdir(), 'npm-docs-to-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(from, name), text);
  const r = spawnSync(process.execPath, [script, from, to, ...Object.keys(files)], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return (name: string) => readFileSync(join(to, name), 'utf8');
};

// Link and image targets that name no scheme and are not an anchor on the same page.
const relativeTargets = (md: string) =>
  [...md.replace(/^```[\s\S]*?^```/gm, '').matchAll(/\]\(([^)\s]+)|<img [^>]*src="([^"]+)"/g)]
    .map((m) => m[1] ?? m[2])
    .filter((t) => !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith('#'));

describe('scripts/npm-docs.mjs', () => {
  it('links to the files on GitHub, keeping the anchor, since npm has no docs folder to resolve them in', () => {
    const out = copy({ 'README.md': '[Install](docs/guide/install.md) and [the rest](docs/guide/usage.md#sessions), [中文](README.zh-CN.md)\n' });
    expect(out('README.md')).toBe(`[Install](${BLOB}docs/guide/install.md) and [the rest](${BLOB}docs/guide/usage.md#sessions), [中文](${BLOB}README.zh-CN.md)\n`);
  });

  it('shows images from GitHub’s raw files, in markdown and in html', () => {
    const out = copy({ 'README.md': '![Chat](docs/screens/chat.png)\n<img src="docs/screens/choice.png" width="250">\n' });
    expect(out('README.md')).toBe(`![Chat](${RAW}docs/screens/chat.png)\n<img src="${RAW}docs/screens/choice.png" width="250">\n`);
  });

  it('leaves web addresses, anchors on the page and code blocks as they are', () => {
    const text = '[Site](https://example.com/a.md) [Up](#install) [Mail](mailto:a@example.com)\n```\n[not a link](docs/x.md)\n```\n';
    expect(copy({ 'README.md': text })('README.md')).toBe(text);
  });

  it('leaves none of the real README and SECURITY relative', () => {
    const files = { 'README.md': readFileSync(join(root, 'README.md'), 'utf8'), 'SECURITY.md': readFileSync(join(root, 'SECURITY.md'), 'utf8') };
    expect(relativeTargets(files['README.md']).length, 'the README has relative links to rewrite').toBeGreaterThan(0);
    const out = copy(files);
    expect(relativeTargets(out('README.md'))).toEqual([]);
    expect(relativeTargets(out('SECURITY.md'))).toEqual([]);
  });

  it('copies other files unchanged', () => {
    expect(copy({ LICENSE: 'MIT License\n[x](y)\n' })('LICENSE')).toBe('MIT License\n[x](y)\n');
  });
});
