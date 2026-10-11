import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { DEMO_HOME as HOME, DEMO_PORT as PORT } from './playwright.config';

// A phone recording of the real web app, with a scripted Claude: what the demo GIF is cut from (make.sh).

const ORIGIN = `http://localhost:${PORT}`;
const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = join(HERE, 'out');
const CODE = '/Users/Shared/code';
const PROJECTS = ['weather-app', 'api-server', 'blog'];

const W = {
  'zh-CN': {
    ask: '深色模式下登录按钮太平了，改成圆角，再加一个悬停效果。',
    look: '我先看一下按钮的样式。',
    find: '找按钮样式',
    runTests: '跑按钮的测试',
    beforeDeploy: '改好了，4 个测试全过。部署前问你一件事。',
    question: ['☐ 部署', '', '这次修改发到哪里？'],
    options: [
      ['只发预发环境', '生产环境不动'],
      ['先预发，再生产', '一次发完，预发在前'],
      ['等到周一', '在那之前什么都不动'],
    ],
    done: '已经发到预发，检查通过后又发到了生产。\n\n- 登录按钮：**8px 圆角**，悬停变亮\n- 测试：4 个全部通过',
    rateLimit: '给登录接口加上限流',
    post: '把更新说明改写成一篇博客',
    postReply: '初稿写好了，要我配几张截图吗？',
    old: '把天气卡片的单位改成摄氏度',
    oldReply: '改好了，卡片现在显示 °C。',
    titles: { button: '登录按钮改圆角', rateLimit: '登录接口限流', post: '更新说明改写成博客' },
    cap: ['Mac 上的 Claude Code、Codex 会话\n手机上一眼看全', '在手机上给它派活', '它在你的 Mac 上干活\n每一步实时传到手机', '要你拍板时\n点一下就行', '不用守在电脑前'],
  },
  en: {
    ask: 'The sign-in button looks flat in dark mode. Round it off and give it a hover state.',
    look: 'Let me look at how the button is styled.',
    find: 'Find the button styles',
    runTests: 'Run the button tests',
    beforeDeploy: 'Done, and 4 of 4 tests pass. One question before I deploy.',
    question: ['☐ Deploy', '', 'Where should the fix go out?'],
    options: [
      ['Staging only', 'Production stays as it is'],
      ['Staging, then production', 'Both in one go, staging first'],
      ['Wait until Monday', 'Nothing changes until then'],
    ],
    done: 'Deployed to staging, checked, then to production.\n\n- Sign-in button: **8px corners**, lighter on hover\n- Tests: 4 of 4 pass',
    rateLimit: 'Add rate limiting to the sign-in endpoint',
    post: 'Turn the release notes into a blog post',
    postReply: 'The draft is ready. Want screenshots in it?',
    old: 'Show the weather card in Celsius',
    oldReply: 'Done: the card shows °C now.',
    titles: { button: 'Round the sign-in button', rateLimit: 'Rate-limit sign-in', post: 'Release notes as a blog post' },
    cap: ["Every Claude Code and Codex session on your Mac,\nat a glance on your phone", 'Give it work from your phone', 'It works on your Mac;\nevery step shows up live', 'When it needs a decision,\none tap', 'No need to sit at your desk'],
  },
};

const at = () => new Date().toISOString();
const rec = {
  user: (content: unknown) => ({ type: 'user', timestamp: at(), message: { role: 'user', content } }),
  claude: (block: unknown) => ({ type: 'assistant', timestamp: at(), message: { role: 'assistant', content: [block] } }),
  title: (aiTitle: string) => ({ type: 'ai-title', aiTitle }),
  result: (id: string, content: string, toolUseResult?: object) => ({
    ...rec.user([{ type: 'tool_result', tool_use_id: id, content }]),
    ...(toolUseResult && { toolUseResult }),
  }),
};
const line = (r: unknown) => `${JSON.stringify(r)}\n`;
const api = (page: Page, method: string, path: string, data?: unknown) => page.request.fetch(`${ORIGIN}${path}`, { method, data, headers: { origin: ORIGIN } });
const hook = (id: string, event: string) =>
  new Promise<void>((resolve) =>
    execFile('curl', ['-s', '--max-time', '3', '--unix-socket', join(HOME, 'hooks.sock'), '-H', `x-workoffdesk-session: ${id}`, '--data-binary', JSON.stringify({ hook_event_name: event }), 'http://localhost/hook'], () => resolve()),
  );

async function session(page: Page, project: string) {
  const res = await api(page, 'POST', '/api/m/local/sessions', { kind: 'claude', cwd: join(CODE, project) });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  type S = { id: string; claudeSessionId: string; status: string };
  await expect.poll(async () => ((await (await api(page, 'GET', '/api/m/local/sessions')).json()) as S[]).find((x) => x.id === id)?.status).toBe('idle');
  const s = ((await (await api(page, 'GET', '/api/m/local/sessions')).json()) as S[]).find((x) => x.id === id)!;
  return { id, transcript: join(HOME, 'claude-projects', '-p', `${s.claudeSessionId}.jsonl`) };
}

const created: string[] = [];
test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
  // The fake claude stays, as a shell at its prompt, so its sessions run and keys sent to them land.
  const fake = join(HOME, 'claude');
  writeFileSync(fake, readFileSync(fake, 'utf8').replace(/^\[ -f .*claude-stays.*$/m, 'exec sh'));
  const transcripts = join(HOME, 'claude-projects', '-p');
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

test('demo', async ({ browser }, info) => {
  const lang = info.project.name as keyof typeof W;
  const w = W[lang];
  const setup = await browser.newContext({ ...info.project.use, baseURL: ORIGIN });
  const sp = await setup.newPage();
  expect((await api(sp, 'POST', '/api/auth/password', { username: 'alice', password: 'correct horse battery' })).ok()).toBe(true);
  // Ending a session keeps it as past; deleting it then takes it off the list.
  for (let pass = 0; pass < 2; pass++)
    for (const s of await (await api(sp, 'GET', '/api/m/local/sessions')).json()) await api(sp, 'DELETE', `/api/m/local/sessions/${s.id}`);

  const blog = await session(sp, 'blog');
  writeFileSync(blog.transcript, [rec.user(w.post), rec.claude({ type: 'text', text: w.postReply }), rec.title(w.titles.post)].map(line).join(''));
  await hook(blog.id, 'UserPromptSubmit');
  await hook(blog.id, 'Stop');
  const apiS = await session(sp, 'api-server');
  writeFileSync(apiS.transcript, [rec.user(w.rateLimit), rec.title(w.titles.rateLimit)].map(line).join(''));
  await hook(apiS.id, 'UserPromptSubmit');
  const weather = await session(sp, 'weather-app');
  writeFileSync(weather.transcript, [rec.user(w.old), rec.claude({ type: 'text', text: w.oldReply }), rec.title(w.titles.button)].map(line).join(''));
  await hook(weather.id, 'UserPromptSubmit');
  await hook(weather.id, 'Stop');
  const cookies = await setup.cookies();
  await setup.close();

  // The recorded phone: signed in already, so the recording starts on the list.
  const ctx = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2, baseURL: ORIGIN });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByTestId('session-card')).toHaveCount(3);
  await page.waitForTimeout(500);
  const t0 = Date.now();
  // Frames as fast as the page gives them, each with its time: crisper than the screencast.
  const frames: { t: number; buf: Buffer }[] = [];
  let rolling = true;
  const roll = (async () => {
    while (rolling) {
      const t = (Date.now() - t0) / 1000;
      try {
        frames.push({ t, buf: await page.screenshot({ type: 'jpeg', quality: 88, animations: 'allow', caret: 'initial' }) });
      } catch {
        // A frame missed while the page navigates.
      }
    }
  })();
  const marks: { t: number; cap: number }[] = [];
  const cap = (n: number) => marks.push({ t: (Date.now() - t0) / 1000, cap: n });
  const add = (r: unknown) => appendFileSync(weather.transcript, line(r));
  const pause = (ms: number) => page.waitForTimeout(ms);

  cap(0);
  await pause(3200);

  await page.getByTestId('session-card').filter({ hasText: w.titles.button }).click();
  await expect(page.getByTestId('chat').getByText(w.oldReply)).toBeVisible();
  cap(1);
  await pause(700);
  const input = page.getByLabel(lang === 'en' ? 'Message' : '输入');
  await page.locator('.hold-bar').click();
  await expect(input).toBeFocused();
  await input.pressSequentially(w.ask, { delay: lang === 'en' ? 35 : 80 });
  await pause(500);
  const sent = page.waitForResponse((r) => r.url().endsWith('/messages') && r.request().method() === 'POST');
  await page.getByRole('button', { name: lang === 'en' ? 'Send' : '发送' }).click();
  await sent;
  await page.waitForTimeout(300);
  await hook(weather.id, 'UserPromptSubmit');
  add(rec.user(w.ask));
  await pause(1300);

  cap(2);
  const css = join(CODE, 'weather-app', 'src/components/Button.css');
  add(rec.claude({ type: 'text', text: w.look }));
  await pause(1100);
  add(rec.claude({ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'grep -rn "\\.btn" src', description: w.find } }));
  await pause(700);
  add(rec.result('b1', 'src/components/Button.css:1: .btn {'));
  await pause(900);
  add(rec.claude({ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: css, old_string: 'border-radius: 0;', new_string: 'border-radius: 8px;' } }));
  add(
    rec.result('e1', 'ok', {
      filePath: css,
      structuredPatch: [{ oldStart: 1, oldLines: 4, newStart: 1, newLines: 6, lines: [' .btn {', '-  border-radius: 0;', '+  border-radius: 8px;', '+  transition: background 120ms;', '   background: var(--accent);', ' }', '+.btn:hover { background: var(--accent-hover); }'] }],
    }),
  );
  await pause(1500);
  add(rec.claude({ type: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'pnpm test Button', description: w.runTests } }));
  await pause(900);
  add(rec.result('b2', '✓ Button (4 tests) 212ms'));
  await pause(600);
  add(rec.claude({ type: 'text', text: w.beforeDeploy }));
  await pause(800);

  // Claude Code's question, drawn by a picker that answers keys as Claude Code's does.
  const file = join(HOME, 'question.json');
  writeFileSync(file, JSON.stringify({ question: w.question, options: w.options }));
  const picker = join(HOME, 'q.sh');
  writeFileSync(picker, `'${process.execPath}' '${join(HERE, 'question.mjs')}' '${file}'; clear; tmux clear-history\n`);
  await api(page, 'POST', `/api/m/local/sessions/${weather.id}/keys`, { keys: `clear; sh ${picker}\r` });
  await expect.poll(async () => ((await (await api(page, 'GET', `/api/m/local/sessions/${weather.id}/screen`)).json()) as { text: string }).text).toContain(w.options[2][0]);
  await hook(weather.id, 'Notification');
  const option = page.getByRole('radio', { name: new RegExp(w.options[1][0]) });
  await expect(option).toBeVisible();
  cap(3);
  await pause(1800);
  await option.click();
  await pause(900);
  await page.locator('.chat-choice .btn.primary').click();
  // The picker takes the answer and leaves; only then does Claude go on.
  await expect.poll(async () => ((await (await api(page, 'GET', `/api/m/local/sessions/${weather.id}/screen`)).json()) as { text: string }).text).not.toContain(w.options[2][0]);
  await hook(weather.id, 'PostToolUse');
  await expect(page.locator('.chat-choice')).toHaveCount(0);
  await pause(1500);
  add(rec.claude({ type: 'text', text: w.done }));
  await hook(weather.id, 'Stop');
  await expect(page.getByTestId('chat').locator('.reply strong').last()).toBeVisible();
  cap(4);
  await pause(3500);
  const end = (Date.now() - t0) / 1000;

  rolling = false;
  await roll;
  await ctx.close();
  const dir = join(OUT, `frames-${lang}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  frames.forEach((f, i) => writeFileSync(join(dir, `${String(i).padStart(4, '0')}.jpg`), f.buf));
  writeFileSync(join(dir, 'times.json'), JSON.stringify(frames.map((f) => f.t)));
  writeFileSync(join(OUT, `app-${lang}.json`), JSON.stringify({ marks, end, caps: w.cap }));
});
