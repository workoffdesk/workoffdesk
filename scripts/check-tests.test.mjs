import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const SCRIPT = new URL('./check-tests.mjs', import.meta.url).pathname;

// A repository holding only the files the check reads; a file given as '' is empty.
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'check-tests-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, root], { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) {
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
}

const server = (files) => ({ 'apps/server/package.json': '{}', ...files });
// Spelt out in a fixture, the word would start titles in this file too.
const word = 'should';

describe('check-tests.mjs', () => {
  describe('where a test file sits', () => {
    test('passes when each test file mirrors the source it tests', () => {
      const r = repo(server({
        'apps/server/src/store.ts': '',
        'apps/server/src/agents/claude/tracker.ts': '',
        'apps/server/tests/unit/store.test.ts': '',
        'apps/server/tests/integration/agents/claude/tracker.test.ts': '',
        'libs/client/package.json': '{}',
        'libs/client/src/chat.ts': '',
        'libs/client/tests/chat.test.ts': '',
      }));
      assert.equal(r.code, 0, r.out);
    });

    test('takes a module tested by area, as <module>.<area>.test.ts', () => {
      const r = repo(server({ 'apps/server/src/machine.ts': '', 'apps/server/tests/unit/machine.status.test.ts': '' }));
      assert.equal(r.code, 0, r.out);
    });

    test('lets package/ hold what holds for the whole package, and scripts/ test its scripts', () => {
      const r = repo(server({
        'apps/server/scripts/build-app-update.mjs': '',
        'apps/server/tests/unit/package/isolation.test.ts': '',
        'apps/server/tests/unit/scripts/build-app-update.test.ts': '',
      }));
      assert.equal(r.code, 0, r.out);
    });

    test('takes a file of the package or of the repository, named in full', () => {
      const r = repo(server({
        'install.sh': '',
        'apps/server/tests/integration/install.sh.test.ts': '',
        'apps/mobile/package.json': '{}',
        'apps/mobile/app.config.ts': '',
        'apps/mobile/tests/app.config.test.mjs': '',
        'apps/web/package.json': '{}',
        'apps/web/src/styles.css': '',
        'apps/web/tests/unit/styles.css.test.ts': '',
      }));
      assert.equal(r.code, 0, r.out);
    });

    test('fails on a test file with no source, naming it and what it would test', () => {
      const r = repo(server({
        'apps/server/src/store.ts': '',
        'apps/server/src/journal/db.ts': '',
        'apps/server/tests/unit/stores.test.ts': '',
        'apps/server/tests/unit/journal.test.ts': '',
      }));
      assert.equal(r.code, 1);
      assert.match(r.out, /apps\/server\/tests\/unit\/stores\.test\.ts tests nothing there is: no apps\/server\/src\/stores/);
      assert.match(r.out, /apps\/server\/tests\/unit\/journal\.test\.ts tests nothing there is/);
    });

    test('fails on a test file among the helpers or fixtures', () => {
      const r = repo(server({
        'apps/server/src/until.ts': '',
        'apps/server/tests/helpers/until.test.ts': '',
        'apps/server/tests/fixtures/until.test.ts': '',
      }));
      assert.equal(r.code, 1);
      assert.match(r.out, /apps\/server\/tests\/helpers\/until\.test\.ts is a test among the helpers/);
      assert.match(r.out, /apps\/server\/tests\/fixtures\/until\.test\.ts is a test among the fixtures/);
    });

    test('leaves end-to-end specs, and what is installed or built, alone', () => {
      const theirs = `it('${word} work', () => {});\n`;
      const r = repo(server({
        'apps/server/tests/e2e/chat.spec.ts': '',
        'apps/server/node_modules/x/tests/y.test.ts': theirs,
        'libs/client/node_modules/x/y.test.js': theirs,
        'apps/server/dist/tests/z.test.ts': theirs,
      }));
      assert.equal(r.code, 0, r.out);
    });
  });

  describe('test titles', () => {
    const titled = (text) => repo(server({ 'apps/server/src/store.ts': '', 'apps/server/tests/unit/store.test.ts': text }));

    test('passes titles that say what the code does', () => {
      const r = titled(`describe('createStore', () => {\n  it('shoulders the load', () => {});\n  it("says '${word}' in a title", () => {});\n});\n`);
      assert.equal(r.code, 0, r.out);
    });

    test('fails on a title that starts with should, naming the file and line', () => {
      const r = titled(`describe('createStore', () => {\n  it('${word} keep a value', () => {});\n});\n`);
      assert.equal(r.code, 1);
      assert.match(r.out, /apps\/server\/tests\/unit\/store\.test\.ts:2 starts a title with "should"/);
    });

    for (const [form, text, line] of [
      ['a describe', `describe('S${word.slice(1)} it', () => {});\n`, 1],
      ['a test', `test(\`${word} keep a value\`, () => {});\n`, 1],
      ['an it.each', `it.each([1, 2])('${word} keep %s', () => {});\n`, 1],
      ['an it.each after a table of its own lines', `it.each([\n  [1],\n])('${word} keep %s', () => {});\n`, 3],
      ['a describe.skipIf', `describe.skipIf(true)('${word} keep a value', () => {});\n`, 1],
    ]) {
      test(`finds it in ${form}`, () => {
        const r = titled(text);
        assert.equal(r.code, 1, r.out);
        assert.match(r.out, new RegExp(`store\\.test\\.ts:${line} starts a title with "should"`));
      });
    }
  });
});
