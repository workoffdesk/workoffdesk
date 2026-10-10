#!/usr/bin/env node
// Copies the docs the npm package ships from the repository root. In markdown files, links to the
// repository's files point at GitHub and images at its raw files: npm has no docs folder to resolve
// them in. Code blocks, anchors on the page and web addresses stay as they are.
//   node scripts/npm-docs.mjs <from> <to> <name>...
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const repo = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const blob = `${repo}/blob/main/`;
const raw = `${repo.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/main/`;

const relative = (target) => !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('#');
const absolute = (md) =>
  md
    .split(/^(```[\s\S]*?^```)/m)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (all, bang, text, target) =>
              relative(target) ? `${bang}[${text}](${bang ? raw : blob}${target})` : all,
            )
            .replace(/(<img [^>]*src=")([^"]+)"/g, (all, head, target) => (relative(target) ? `${head}${raw}${target}"` : all)),
    )
    .join('');

const [from, to, ...names] = process.argv.slice(2);
for (const name of names) {
  const text = readFileSync(join(from, name), 'utf8');
  writeFileSync(join(to, name), name.endsWith('.md') ? absolute(text) : text);
}
