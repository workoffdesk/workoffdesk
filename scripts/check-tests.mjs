#!/usr/bin/env node
// Every test file sits where the code it tests is, so a reader finds a module's tests without searching:
// tests/[unit|integration/]<path>.test.ts tests src/<path>.ts, or one area of it as <path>.<area>.test.ts.
// tests/…/package/ holds what holds for the whole package, and a file of the package or the repository is
// tested under its full name (scripts/<name>, app.config, install.sh). End-to-end specs are named by flow.
// No title starts with "should": a title says what the code does.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? new URL('..', import.meta.url).pathname;

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

const isFile = (path) => existsSync(join(root, path)) && statSync(join(root, path)).isFile();
const EXTENSIONS = ['', '.ts', '.tsx', '.mjs', '.js'];

const TEST_FILE = /^(apps|libs)\/[^/]+\/tests\/(.+)\.test\.[cm]?[jt]sx?$/;
const problems = [];

for (const file of ['apps', 'libs'].flatMap(walk)) {
  const m = TEST_FILE.exec(file);
  if (!m) continue;
  const pkg = file.slice(0, file.indexOf('/tests/'));
  const [first, ...rest] = m[2].split('/');
  if (first === 'helpers' || first === 'fixtures') {
    problems.push(`${file} is a test among the ${first}: those hold what tests import or run`);
    continue;
  }
  const path = ['unit', 'integration'].includes(first) ? rest : [first, ...rest];
  if (path[0] === 'package') continue;
  // install.sh.test.ts tests install.sh; machine.status.test.ts tests one area of machine.ts.
  const names = [];
  for (let name = path.join('/'); ; name = name.slice(0, name.lastIndexOf('.'))) {
    names.push(name);
    if (!/\.[^/]*$/.test(name)) break;
  }
  const found = names.some((name) =>
    [`${pkg}/src/${name}`, `${pkg}/${name}`, name].some((base) => EXTENSIONS.some((ext) => isFile(base + ext))),
  );
  if (!found) problems.push(`${file} tests nothing there is: no ${pkg}/src/${path.join('/')}, nor a file of that name in the package or the repository`);
}

// The first argument of describe/it/test, of their .each(…)/.skipIf(…) forms, and after a table that ends a line
// before it.
const SHOULD = /(?:\b(?:describe|it|test|suite)(?:\.\w+)*(?:\([^()]*(?:\([^()]*\))?[^()]*\))?|^\s*[\])]+)\(\s*['"`]should\b/i;
for (const file of ['apps', 'libs', 'scripts'].flatMap(walk).filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f))) {
  readFileSync(join(root, file), 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (SHOULD.test(line)) problems.push(`${file}:${i + 1} starts a title with "should"; say what the code does`);
    });
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
