import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const SCRIPT = new URL('./check-docs.mjs', import.meta.url).pathname;

// A repository holding only the documents the check reads.
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'check-docs-'));
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

const pair = (en, zh) => ({ 'README.md': '# A\n', 'README.zh-CN.md': '# 甲\n', 'docs/guide/install.md': en, 'docs/guide/install.zh-CN.md': zh });

const linked = (files) => ({ 'README.md': '# A\n', 'README.zh-CN.md': '# 甲\n', ...files });

// The test map in docs/testing.md names every test file, so a test added without a place on it fails the check.
const MAP = '# Testing\n## The map\n- `apps/server/tests/unit/a.test.ts`, `libs/client/tests/b.test.ts`\n- `apps/mac/Tests/KitTests/CTests.swift`\n';
const tests = (files) =>
  linked({
    'apps/server/tests/unit/a.test.ts': '',
    'libs/client/tests/b.test.ts': '',
    'apps/mac/Tests/KitTests/CTests.swift': '',
    ...files,
  });

describe('check-docs.mjs', () => {
  describe('the guides and their Chinese twins', () => {
    test('passes when every guide has its Chinese twin with the same headings', () => {
      assert.equal(repo(pair('# Install\n## Mac\n### Node\n', '# 安装\n## Mac\n### Node\n')).code, 0);
    });

    test('fails on a guide without its Chinese twin, naming it', () => {
      const r = repo({ 'README.md': '# A\n', 'README.zh-CN.md': '# 甲\n', 'docs/guide/usage.md': '# Usage\n' });
      assert.equal(r.code, 1);
      assert.match(r.out, /docs\/guide\/usage\.zh-CN\.md/);
    });

    test('fails on a Chinese guide whose English one is missing', () => {
      const r = repo({ 'README.md': '# A\n', 'README.zh-CN.md': '# 甲\n', 'docs/guide/usage.zh-CN.md': '# 用法\n' });
      assert.equal(r.code, 1);
      assert.match(r.out, /docs\/guide\/usage\.md/);
    });

    test('fails when the twins have different heading outlines, naming the pair', () => {
      const r = repo(pair('# Install\n## Mac\n## Phone\n', '# 安装\n## Mac\n### 手机\n'));
      assert.equal(r.code, 1);
      assert.match(r.out, /docs\/guide\/install\.md/);
    });

    test('compares the READMEs the same way', () => {
      const r = repo({ 'README.md': '# A\n## B\n', 'README.zh-CN.md': '# 甲\n' });
      assert.equal(r.code, 1);
      assert.match(r.out, /README\.md/);
    });

    test('does not count a # inside a code block as a heading', () => {
      assert.equal(repo(pair('# Install\n```bash\n# a comment\n```\n', '# 安装\n```bash\n# 注释\n# 两行\n```\n')).code, 0);
    });
  });

  describe('links', () => {
    test('fails on a link to a file that does not exist, naming where it is', () => {
      const r = repo(linked({ 'docs/guide/usage.md': '# Usage\nSee [install](install.md).\n', 'docs/guide/usage.zh-CN.md': '# 用法\n' }));
      assert.equal(r.code, 1);
      assert.match(r.out, /docs\/guide\/usage\.md.*install\.md/);
    });

    test('fails on a link to a heading the page does not have', () => {
      const r = repo(linked({ 'CONTRIBUTING.md': '# C\nSee [push](docs/guide/configuration.zh-CN.md#推送).\n', 'docs/guide/configuration.md': '# Configuration\n## Push\n', 'docs/guide/configuration.zh-CN.md': '# 配置\n## iPhone App 的通知\n' }));
      assert.equal(r.code, 1);
      assert.match(r.out, /CONTRIBUTING\.md.*#推送/);
    });

    test('follows links to files, images and headings that exist, the way GitHub names headings', () => {
      const r = repo(
        linked({
          'README.zh-CN.md': '# 甲\n## 外网访问\n',
          'README.md': '# A\n## Remote access (HTTPS)\n![chat](docs/screens/chat.png) <img src="docs/screens/chat.png" width="200">\n[up](#remote-access-https) [guide](docs/guide/configuration.zh-CN.md#iphone-app-的通知)\n',
          'docs/screens/chat.png': '',
          'docs/guide/configuration.md': '# Configuration\n## iPhone app notifications\n',
          'docs/guide/configuration.zh-CN.md': '# 配置\n## iPhone App 的通知\n',
        }),
      );
      assert.equal(r.code, 0, r.out);
    });

    test('leaves web links and links inside code alone', () => {
      const r = repo(linked({ 'SECURITY.md': '# S\n[web](https://example.com/missing.md) [mail](mailto:a@example.com)\n`[x](nowhere.md)`\n```md\n[y](nowhere.md)\n```\n' }));
      assert.equal(r.code, 0, r.out);
    });
  });

  describe('the test map', () => {
    test('passes when the test map names every test file, leaving out what is installed or built', () => {
      const r = repo(tests({ 'docs/testing.md': MAP, 'apps/server/src/a.ts': '', 'apps/web/node_modules/x/y.test.js': '', 'apps/server/dist/z.test.js': '', 'apps/mobile/ios/Pods/P/QTests.swift': '' }));
      assert.equal(r.code, 0, r.out);
    });

    test('takes only test files from the map, not the commands and sources it names in passing', () => {
      const r = repo(tests({ 'apps/server/src/a.ts': '', 'docs/testing.md': `${MAP}Run \`pnpm check\`; the rule lives in \`apps/server/src/a.ts\`.\n` }));
      assert.equal(r.code, 0, r.out);
    });

    test('takes the map from its own section, not the examples on the page around it', () => {
      const page = MAP.replace('## The map', '## Writing a test\nA file such as `apps/server/tests/unit/<path>.test.ts`.\n## The map');
      const r = repo(tests({ 'docs/testing.md': `${page}## Known gaps\nNothing yet for \`libs/client/tests/<area>.test.ts\`.\n` }));
      assert.equal(r.code, 0, r.out);
    });

    test('fails on a page whose map has lost its heading', () => {
      const r = repo(tests({ 'docs/testing.md': MAP.replace('## The map', '## Files') }));
      assert.equal(r.code, 1);
      assert.match(r.out, /apps\/server\/tests\/unit\/a\.test\.ts is not on the test map/);
    });

    test('fails on a test file the page names only outside the map', () => {
      const page = MAP.replace('## The map', '## Writing a test\nLike `apps/server/tests/e2e/c.spec.ts`.\n## The map');
      const r = repo(tests({ 'docs/testing.md': page, 'apps/server/tests/e2e/c.spec.ts': '' }));
      assert.equal(r.code, 1);
      assert.match(r.out, /apps\/server\/tests\/e2e\/c\.spec\.ts is not on the test map/);
    });

    test('fails on a test file the map does not name, naming it', () => {
      const r = repo(tests({ 'docs/testing.md': MAP, 'apps/server/tests/e2e/c.spec.ts': '', 'scripts/d.test.mjs': '', 'apps/mac/Tests/UITests/ETests.swift': '' }));
      assert.equal(r.code, 1);
      assert.match(r.out, /apps\/server\/tests\/e2e\/c\.spec\.ts.*docs\/testing\.md/);
      assert.match(r.out, /scripts\/d\.test\.mjs/);
      assert.match(r.out, /apps\/mac\/Tests\/UITests\/ETests\.swift/);
    });

    test('fails on a map entry that is not a test file there is', () => {
      const r = repo(tests({ 'docs/testing.md': `${MAP}- \`libs/client/tests/gone.test.ts\`\n` }));
      assert.equal(r.code, 1);
      assert.match(r.out, /libs\/client\/tests\/gone\.test\.ts/);
    });

    test('fails when there are tests and no test map', () => {
      const r = repo(tests({}));
      assert.equal(r.code, 1);
      assert.match(r.out, /docs\/testing\.md is missing/);
    });
  });

  // A file named in a document's prose, as `apps/...`, `libs/...`, `scripts/...` or `docs/...`, is one there is:
  // a file that moves leaves no pointer behind that no link check would see.
  describe('paths named in prose', () => {
    const there = { 'apps/server/src/cli.ts': '', 'libs/client/src/api.ts': '', 'scripts/check.mjs': '', 'docs/notes.md': '' };

    for (const [what, path] of [
      ['an app', 'apps/server/src/gone.ts'],
      ['a lib', 'libs/client/src/gone.ts'],
      ['a script', 'scripts/gone.sh'],
      ['a document', 'docs/gone.md'],
    ])
      test(`fails on ${what} named in prose that does not exist, naming the page and the path`, () => {
        const r = repo(linked({ ...there, 'docs/facts.md': `- A fact. (\`${path}\`)\n` }));
        assert.equal(r.code, 1);
        assert.match(r.out, new RegExp(`docs/facts\\.md names ${path.replace(/\./g, '\\.')}, which does not exist`));
      });

    test('passes on files and folders there are, with or without a line number', () => {
      const r = repo(linked({ ...there, 'CONTRIBUTING.md': '`apps/server/src/cli.ts`, `apps/server/src/`, `libs/client/src/api.ts:12`, `scripts/check.mjs`, `docs/notes.md`\n' }));
      assert.equal(r.code, 0, r.out);
    });

    test('leaves alone code blocks, patterns, the git-ignored docs/private/, design records and the changelog', () => {
      const r = repo(
        linked({
          'AGENTS.md': '```\n`apps/gone.ts`\n```\n`apps/*`, `docs/guide/<name>.md`, `docs/private/`\n',
          'docs/design/2026-01-01-old.md': '# Old\n`apps/server/src/moved.ts`\n',
          'CHANGELOG.md': '- `libs/client/src/removed.ts` removed\n',
        }),
      );
      assert.equal(r.code, 0, r.out);
    });
  });
});
