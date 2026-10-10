#!/usr/bin/env node
// Prints the changelog's section for a release tag (v3.0.0 → "## 3.0.0"), for the GitHub release's notes.
//   node scripts/changelog-section.mjs <tag> [CHANGELOG.md]
import { readFileSync } from 'node:fs';

const [tag, file = new URL('../CHANGELOG.md', import.meta.url)] = process.argv.slice(2);
const version = tag?.replace(/^v/, '');
const lines = readFileSync(file, 'utf8').split('\n');
const start = lines.findIndex((l) => l.trim() === `## ${version}`);
if (!version || start < 0) {
  console.error(`CHANGELOG.md has no "## ${version}" section`);
  process.exit(1);
}
const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
process.stdout.write(`${body}\n`);
