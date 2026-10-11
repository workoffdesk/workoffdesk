import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { SCREENS_HOME, SCREENS_PORT } from '../../playwright.screens.config';

// The screenshots the README shows, in English and in Chinese. Run with `pnpm --filter workoffdesk screens`.

const ORIGIN = `http://localhost:${SCREENS_PORT}`;
const OUT = fileURLToPath(new URL('../../../../docs/screens', import.meta.url));
// shortPath shows any /Users/<name>/ as ~/, so these read as ~/code/<project>, like a project of the reader's own.
const CODE = '/Users/Shared/code';
const PROJECTS = ['weather-app', 'api-server', 'blog'];

const words = {
  en: {
    ask: 'The sign-in button looks flat in dark mode. Round it off and give it a hover state.',
    look: 'Let me look at how the button is styled.',
    find: 'Find the button styles',
    runTests: 'Run the button tests',
    done: [
      'Done. The sign-in button now has **8px corners** and lightens on hover.',
      '',
      '- `Button.css`: the radius, a transition and a `:hover` rule',
      '- Tests: 4 of 4 pass',
      '',
      'Want the secondary buttons to match?',
    ].join('\n'),
    doneShort: 'Done: 8px corners and a hover state. 4 of 4 tests pass.',
    ship: 'Ship the button fix.',
    beforeDeploy: 'Tests pass and the build is clean. One question before I deploy.',
    question: ['☐ Deploy', '', 'Where should the fix go out?'],
    options: [
      ['Staging only', 'Production stays as it is'],
      ['Staging, then production', 'Both in one go, staging first'],
      ['Wait until Monday', 'Nothing changes until then'],
    ],
    rateLimit: 'Add rate limiting to the sign-in endpoint',
    post: 'Turn the release notes into a blog post',
    // What Claude Code calls each conversation, as the list shows it.
    titles: { button: 'Round the sign-in button', rateLimit: 'Rate-limit sign-in', post: 'Release notes as a blog post' },
  },
  'zh-CN': {
    ask: '深色模式下登录按钮太平了，改成圆角，再加一个悬停效果。',
    look: '我先看一下按钮的样式。',
    find: '找按钮样式',
    runTests: '跑按钮的测试',
    done: [
      '改好了。登录按钮现在是 **8px 圆角**，悬停时会变亮。',
      '',
      '- `Button.css`：圆角、过渡和一条 `:hover` 规则',
      '- 测试：4 个全部通过',
      '',
      '要不要把次要按钮也改成一样的？',
    ].join('\n'),
    doneShort: '改好了：8px 圆角加悬停效果，4 个测试全过。',
    ship: '把按钮的修改发出去。',
    beforeDeploy: '测试通过，构建也没问题。部署前问你一件事。',
    question: ['☐ 部署', '', '这次修改发到哪里？'],
    options: [
      ['只发预发环境', '生产环境不动'],
      ['先预发，再生产', '一次发完，预发在前'],
      ['等到周一', '在那之前什么都不动'],
    ],
    rateLimit: '给登录接口加上限流',
    post: '把更新说明改写成一篇博客',
    titles: { button: '登录按钮改圆角', rateLimit: '登录接口限流', post: '更新说明改写成博客' },
  },
};

const at = new Date().toISOString();
const rec = {
  user: (content: unknown) => ({ type: 'user', timestamp: at, message: { role: 'user', content } }),
  claude: (block: unknown) => ({ type: 'assistant', timestamp: at, message: { role: 'assistant', content: [block] } }),
  title: (aiTitle: string) => ({ type: 'ai-title', aiTitle }),
  result: (id: string, content: string, toolUseResult?: object) => ({
    ...rec.user([{ type: 'tool_result', tool_use_id: id, content }]),
    ...(toolUseResult && { toolUseResult }),
  }),
};
const jsonl = (...rs: unknown[]) => rs.map((r) => `${JSON.stringify(r)}\n`).join('');

const api = (page: Page, method: string, path: string, data?: unknown) =>
  page.request.fetch(path, { method, data, headers: { origin: ORIGIN } });

const hook = (_page: Page, id: string, event: string) =>
  new Promise<void>((resolve) =>
    execFile(
      'curl',
      ['-s', '--max-time', '3', '--unix-socket', join(SCREENS_HOME, 'hooks.sock'), '-H', `x-workoffdesk-session: ${id}`,
        '--data-binary', JSON.stringify({ hook_event_name: event }), 'http://localhost/hook'],
      () => resolve(),
    ),
  );

// A Claude session in a project, and the file its transcript is read from.
async function session(page: Page, project: string) {
  const res = await api(page, 'POST', '/api/m/local/sessions', { kind: 'claude', cwd: join(CODE, project) });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const list: { id: string; claudeSessionId: string; status: string }[] = await (await api(page, 'GET', '/api/m/local/sessions')).json();
  const s = list.find((x) => x.id === id)!;
  await expect.poll(async () => ((await (await api(page, 'GET', '/api/m/local/sessions')).json()) as typeof list).find((x) => x.id === id)?.status).toBe('idle');
  return { id, transcript: join(SCREENS_HOME, 'claude-projects', '-p', `${s.claudeSessionId}.jsonl`) };
}

const save = (page: Page, name: string) =>
  page.screenshot({ path: join(OUT, `${name}${test.info().project.name === 'en' ? '' : '.zh-CN'}.png`), animations: 'disabled' });

const created: string[] = [];
test.beforeAll(() => {
  // A Claude that quits is seen to have quit; the fake one stays, as a shell at its prompt, so its sessions run.
  const fake = join(SCREENS_HOME, 'claude');
  writeFileSync(fake, readFileSync(fake, 'utf8').replace(/^\[ -f .*claude-stays.*$/m, 'exec sh'));
  // The test server's own conversations would show as other sessions on the Mac.
  const transcripts = join(SCREENS_HOME, 'claude-projects', '-p');
  rmSync(transcripts, { recursive: true, force: true });
  mkdirSync(transcripts, { recursive: true });
  for (const dir of [CODE, ...PROJECTS.map((p) => join(CODE, p))]) {
    if (existsSync(dir)) continue;
    mkdirSync(dir);
    created.push(dir);
  }
});
test.afterAll(() => {
  for (const dir of created.splice(0).reverse()) rmSync(dir, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  const res = await api(page, 'POST', '/api/auth/password', { username: 'alice', password: 'correct horse battery' });
  expect(res.ok()).toBe(true);
  // Ending a session keeps it as past; deleting it then takes it off the list.
  for (let pass = 0; pass < 2; pass++)
    for (const s of await (await api(page, 'GET', '/api/m/local/sessions')).json()) await api(page, 'DELETE', `/api/m/local/sessions/${s.id}`);
});

test('chat', async ({ page }) => {
  const w = words[test.info().project.name as keyof typeof words];
  const { id, transcript } = await session(page, 'weather-app');
  const css = join(CODE, 'weather-app', 'src/components/Button.css');
  writeFileSync(
    transcript,
    jsonl(
      rec.user(w.ask),
      rec.claude({ type: 'text', text: w.look }),
      rec.claude({ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'grep -rn "\\.btn" src', description: w.find } }),
      rec.result('b1', 'src/components/Button.css:1: .btn {'),
      rec.claude({ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: css, old_string: 'border-radius: 0;', new_string: 'border-radius: 8px;' } }),
      rec.result('e1', 'ok', {
        filePath: css,
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 4,
            newStart: 1,
            newLines: 6,
            lines: [' .btn {', '-  border-radius: 0;', '+  border-radius: 8px;', '+  transition: background 120ms;', '   background: var(--accent);', ' }', '+.btn:hover { background: var(--accent-hover); }'],
          },
        ],
      }),
      rec.claude({ type: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'pnpm test Button', description: w.runTests } }),
      rec.result('b2', '✓ Button (4 tests) 212ms'),
      rec.claude({ type: 'text', text: w.done }),
      rec.title(w.titles.button),
    ),
  );
  await hook(page, id, 'UserPromptSubmit');
  await hook(page, id, 'Stop');
  await page.goto(`/m/local/s/${id}`);
  const chat = page.getByTestId('chat');
  await expect(chat.locator('.reply strong').last()).toBeVisible();
  await page.waitForTimeout(300);
  await save(page, 'chat');
});

test('choice', async ({ page }) => {
  const w = words[test.info().project.name as keyof typeof words];
  const { id, transcript } = await session(page, 'weather-app');
  writeFileSync(transcript, jsonl(rec.user(w.ship), rec.claude({ type: 'text', text: w.beforeDeploy }), rec.title(w.titles.button)));
  // Claude Code's question, drawn the way it draws one, at the session's prompt.
  const screen = [
    '─'.repeat(60),
    ...w.question.map((l) => ` ${l}`),
    '',
    ...w.options.flatMap(([o, d], i) => [`${i === 0 ? '❯' : ' '} ${i + 1}. ${o}`, `     ${d}`]),
    '  4. Type something.',
    '─'.repeat(60),
    '  5. Chat about this',
    '',
    'Enter to select · ↑/↓ to navigate · Esc to cancel',
  ].join('\n');
  const file = join(SCREENS_HOME, 'question.txt');
  writeFileSync(file, `${screen}\n`);
  await hook(page, id, 'UserPromptSubmit');
  await api(page, 'POST', `/api/m/local/sessions/${id}/keys`, { keys: `clear; cat ${file}; read x\r` });
  await expect.poll(async () => ((await (await api(page, 'GET', `/api/m/local/sessions/${id}/screen`)).json()) as { text: string }).text).toContain(w.options[2][0]);
  await hook(page, id, 'Notification');
  await page.goto(`/m/local/s/${id}`);
  // An option is picked, and taken on Submit.
  await page.getByRole('radio', { name: new RegExp(w.options[1][0]) }).click();
  await expect(page.locator('.chat-choice .btn.primary')).toBeEnabled();
  await page.waitForTimeout(300);
  await save(page, 'choice');
});

test('sessions', async ({ page }) => {
  const w = words[test.info().project.name as keyof typeof words];
  const blog = await session(page, 'blog');
  writeFileSync(blog.transcript, jsonl(rec.user(w.post), rec.title(w.titles.post)));
  await hook(page, blog.id, 'UserPromptSubmit');
  await hook(page, blog.id, 'Notification');

  const api2 = await session(page, 'api-server');
  writeFileSync(api2.transcript, jsonl(rec.user(w.rateLimit), rec.title(w.titles.rateLimit)));
  await hook(page, api2.id, 'UserPromptSubmit');

  const weather = await session(page, 'weather-app');
  writeFileSync(weather.transcript, jsonl(rec.user(w.ask), rec.claude({ type: 'text', text: w.doneShort }), rec.title(w.titles.button)));
  await hook(page, weather.id, 'UserPromptSubmit');
  await hook(page, weather.id, 'Stop');

  await page.goto('/');
  await expect(page.getByTestId('session-card')).toHaveCount(3);
  for (const title of Object.values(w.titles)) await expect(page.getByTestId('session-card').filter({ hasText: title })).toBeVisible();
  await expect(page.getByTestId('session-card').filter({ hasText: w.doneShort.slice(0, 10) })).toBeVisible();
  await page.waitForTimeout(300);
  await save(page, 'sessions');
});

// The web app at the sizes people use it: one page at a time below 900px (a phone held sideways included), the
// list beside the open session from 900px, with the chat a readable column. Saved to the test's own folder.
test('wide', async ({ page }) => {
  test.skip(test.info().project.name !== 'en', 'layout, not words');
  const w = words.en;
  const weather = await session(page, 'weather-app');
  writeFileSync(weather.transcript, jsonl(rec.user(w.ask), rec.claude({ type: 'text', text: w.doneShort })));
  const blog = await session(page, 'blog');
  writeFileSync(blog.transcript, jsonl(rec.user(w.post), rec.claude({ type: 'text', text: w.look })));
  for (const s of [weather, blog]) {
    await hook(page, s.id, 'UserPromptSubmit');
    await hook(page, s.id, 'Stop');
  }
  await page.goto(`/m/local/s/${weather.id}`);
  const chat = page.getByTestId('chat');
  const cards = page.getByTestId('session-card');
  for (const [width, height] of [[390, 844], [844, 390], [768, 1024], [1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await expect(chat.getByText(w.doneShort)).toBeVisible();
    if (width >= 900) {
      await expect(cards).toHaveCount(2);
      const column = await chat.evaluate((el) => {
        const css = getComputedStyle(el);
        return el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      });
      expect(column).toBeLessThanOrEqual(760);
    } else {
      await expect(cards).toHaveCount(0);
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: test.info().outputPath(`wide-${width}x${height}.png`), animations: 'disabled' });
  }
  // Another row opens its own session beside the list, and the one before it goes.
  await cards.filter({ hasText: w.look.slice(0, 12) }).click();
  await expect(chat.getByText(w.look)).toBeVisible();
  await expect(chat.getByText(w.doneShort)).toHaveCount(0);
  // The list on its own: a page of its own when narrow, beside the "choose" note when wide.
  await page.goto('/');
  for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await expect(cards).toHaveCount(2);
    await expect(page.getByText('Choose a session on the left.')).toHaveCount(width >= 900 ? 1 : 0);
    await page.waitForTimeout(300);
    await page.screenshot({ path: test.info().outputPath(`list-${width}x${height}.png`), animations: 'disabled' });
  }
});

// GitHub's social preview for the repository, made of the English screenshots above.
test('social preview', async ({ browser }) => {
  test.skip(test.info().project.name !== 'en', 'one preview, in English');
  const img = (name: string) => `data:image/png;base64,${readFileSync(join(OUT, `${name}.png`)).toString('base64')}`;
  const icon = `data:image/svg+xml;base64,${readFileSync(new URL('../../../web/public/icon.svg', import.meta.url)).toString('base64')}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html>
<body style="margin:0;width:1280px;height:640px;background:#0d1117;color:#e6edf3;font:16px -apple-system,system-ui,sans-serif;display:flex;align-items:center;gap:56px;padding:0 64px;box-sizing:border-box">
  <div style="flex:1">
    <div style="display:flex;align-items:center;gap:20px"><img src="${icon}" style="width:76px;height:76px"><div style="font-size:56px;font-weight:700;letter-spacing:-1px">workoffdesk</div></div>
    <div style="font-size:26px;line-height:1.35;margin-top:16px;color:#c9d1d9">Your Mac's Claude Code and Codex sessions, on your phone.</div>
    <div style="font-size:20px;line-height:1.5;margin-top:20px;color:#8b949e">Chat, answer prompts, pick up<br>where the terminal left off.<br>Self-hosted, no account.</div>
  </div>
  <div style="display:flex;gap:16px">
    ${['chat', 'choice'].map((n) => `<img src="${img(n)}" style="height:520px;border-radius:24px;border:1px solid #30363d">`).join('')}
  </div>
</body>`);
  await page.screenshot({ path: join(OUT, 'social-preview.png') });
  await page.close();
});
