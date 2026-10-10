#!/usr/bin/env node
// The English and Chinese documents are one document in two languages: every guide in docs/guide has its
// .zh-CN twin, and each pair (the READMEs too) has the same outline of headings. Links between documents
// lead to a file, and a heading, that exist, and so does every file a document names in its prose. The test map
// in docs/testing.md names every test file there is.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const root = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const ZH = '.zh-CN.md';

// The lines of a document outside fenced code.
function prose(file) {
  let fenced = false;
  return readFileSync(join(root, file), 'utf8')
    .split('\n')
    .filter((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      else return !fenced;
      return false;
    });
}

const headings = (file) => prose(file).flatMap((line) => {
  const h = /^(#{1,6}) +(.*?)#*\s*$/.exec(line);
  return h ? [{ level: h[1].length, text: h[2] }] : [];
});

const outline = (file) => headings(file).filter((h) => h.level <= 3).map((h) => h.level).join(' ');

// The anchors GitHub gives a document's headings.
function anchors(file) {
  const seen = new Map();
  return new Set(
    headings(file).map(({ text }) => {
      const base = text
        .replace(/`/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
        .replace(/ /g, '-');
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return n ? `${base}-${n}` : base;
    }),
  );
}

// Where a document's links point, leaving out web links and anything in code.
const targets = (file) => prose(file).flatMap((line) => {
  const text = line.replace(/`[^`]*`/g, '');
  const md = [...text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((x) => x[1]);
  const img = [...text.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)].map((x) => x[1]);
  return [...md, ...img].filter((t) => !/^[a-z][a-z0-9+.-]*:/i.test(t));
});

// What is installed or built, not written here.
const NOT_SOURCE = new Set(['node_modules', 'dist', 'build', '.build', '.expo', 'ios', 'android', 'coverage']);

const walk = (dir) =>
  existsSync(join(root, dir))
    ? readdirSync(join(root, dir)).flatMap((f) => {
        const path = join(dir, f);
        if (!statSync(join(root, path)).isDirectory()) return [path];
        return NOT_SOURCE.has(f) ? [] : walk(path);
      })
    : [];

const problems = new Set();

const pairs = [['README.md', `README${ZH}`]];
const guide = 'docs/guide';
for (const f of walk(guide).filter((f) => f.endsWith('.md')).map((f) => relative(guide, f))) {
  if (f.endsWith(ZH)) pairs.push([join(guide, f.slice(0, -ZH.length) + '.md'), join(guide, f)]);
  else pairs.push([join(guide, f), join(guide, f.slice(0, -'.md'.length) + ZH)]);
}
for (const [en, zh] of pairs) {
  const missing = [en, zh].filter((f) => !existsSync(join(root, f)));
  if (missing.length) missing.forEach((f) => problems.add(`${f} is missing (the other language has it)`));
  else if (outline(en) !== outline(zh)) problems.add(`${en} and ${zh} have different headings: ${outline(en)} / ${outline(zh)}`);
}

const documents = [...readdirSync(root).filter((f) => f.endsWith('.md')), ...walk('docs').filter((f) => f.endsWith('.md') && !f.startsWith('docs/private/'))];
for (const file of documents) {
  for (const target of targets(file)) {
    const [path, anchor] = decodeURIComponent(target).split('#');
    const to = path ? join(dirname(file), path) : file;
    if (!existsSync(join(root, to))) problems.add(`${file} links to ${target}, which does not exist`);
    else if (anchor !== undefined && to.endsWith('.md') && !anchors(to).has(anchor)) problems.add(`${file} links to ${target}, which has no such heading`);
  }
}

// A file named in prose (`apps/server/src/cli.ts`) moves without a link to say so. Design records and the
// changelog tell of the code as it was; a pattern (`apps/*`, `<name>`) names no one file.
const NAMED = /`((?:apps|libs|scripts|docs)\/[^`\s*<>{}]*)`/g;
const ofThePast = (file) => file === 'CHANGELOG.md' || file.startsWith('docs/design/');
for (const file of documents.filter((f) => !ofThePast(f))) {
  for (const line of prose(file)) {
    for (const [, named] of line.matchAll(NAMED)) {
      const path = named.replace(/:\d+(-\d+)?$/, '');
      if (!path.startsWith('docs/private/') && !existsSync(join(root, path))) problems.add(`${file} names ${named}, which does not exist`);
    }
  }
}

const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?|\/Tests\/.*Tests\.swift)$/;
const MAP = 'docs/testing.md';
// The map is a section of its own; a test file named elsewhere on the page is an example, not a place on it.
function mapSection(lines) {
  const start = lines.findIndex((line) => /^## The map\s*$/.test(line));
  if (start < 0) return [];
  const end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}
const testFiles = ['apps', 'libs', 'scripts'].flatMap(walk).filter((f) => TEST_FILE.test(f));
if (testFiles.length && !existsSync(join(root, MAP))) problems.add(`${MAP} is missing: it maps every test file to what it guards`);
else if (testFiles.length) {
  const mapped = new Set(mapSection(prose(MAP)).flatMap((line) => [...line.matchAll(/`([^`\s]+)`/g)].map((x) => x[1])).filter((f) => TEST_FILE.test(f)));
  for (const f of testFiles) if (!mapped.has(f)) problems.add(`${f} is not on the test map in ${MAP}`);
  for (const f of mapped) if (!testFiles.includes(f)) problems.add(`${MAP} maps ${f}, which is not a test file there is`);
}

if (problems.size) {
  console.error([...problems].join('\n'));
  process.exit(1);
}
