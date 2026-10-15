import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { DEMO_HOME as HOME, DEMO_PORT as PORT } from './playwright.config';

// The iPhone app in the iOS Simulator, on the test server with a scripted Claude: what the demo GIF is cut from
// (make.sh, which builds the app first).

const ORIGIN = `http://localhost:${PORT}`;
const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = join(HERE, 'out');
const APP = join(OUT, 'WorkOffDesk.app');
const APP_ID = 'com.example.workoffdesk';
const MAESTRO = process.env.MAESTRO ?? join(homedir(), '.maestro', 'bin', 'maestro');
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
    ui: { login: '登录', notNow: '以后', send: '发送', submit: '提交', done: '8px 圆角' },
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
    ui: { login: 'Log in', notNow: 'Not Now', send: 'Send', submit: 'Submit', done: '8px corners' },
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
const api = (request: APIRequestContext, method: string, path: string, data?: unknown) => request.fetch(`${ORIGIN}${path}`, { method, data, headers: { origin: ORIGIN } });
const hook = (id: string, event: string) =>
  new Promise<void>((resolve) =>
    execFile('curl', ['-s', '--max-time', '3', '--unix-socket', join(HOME, 'hooks.sock'), '-H', `x-workoffdesk-session: ${id}`, '--data-binary', JSON.stringify({ hook_event_name: event }), 'http://localhost/hook'], () => resolve()),
  );

async function session(request: APIRequestContext, project: string) {
  const res = await api(request, 'POST', '/api/m/local/sessions', { kind: 'claude', cwd: join(CODE, project) });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  type S = { id: string; claudeSessionId: string; status: string };
  await expect.poll(async () => ((await (await api(request, 'GET', '/api/m/local/sessions')).json()) as S[]).find((x) => x.id === id)?.status).toBe('idle');
  const s = ((await (await api(request, 'GET', '/api/m/local/sessions')).json()) as S[]).find((x) => x.id === id)!;
  return { id, transcript: join(HOME, 'claude-projects', '-p', `${s.claudeSessionId}.jsonl`) };
}

const run = promisify(execFile);
const simctl = (...args: string[]) => run('xcrun', ['simctl', ...args]);
const LOCALES = { en: ['en', 'en_US'], 'zh-CN': ['zh-Hans', 'zh_CN'] } as const;

// A Simulator device of its own, in the run's language and dark, with the app on it: an iPhone 17 Pro Max, whose
// 440x956-point screen is the one compose.py draws.
async function makeDevice(lang: keyof typeof W) {
  const { stdout } = await simctl('create', `workoffdesk-demo-${lang}`, 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max');
  const id = stdout.trim();
  const [language, locale] = LOCALES[lang];
  await simctl('boot', id);
  await simctl('bootstatus', id, '-b');
  await simctl('spawn', id, 'defaults', 'write', '-g', 'AppleLanguages', '-array', language);
  await simctl('spawn', id, 'defaults', 'write', '-g', 'AppleLocale', locale);
  await simctl('shutdown', id);
  await simctl('boot', id);
  await simctl('bootstatus', id, '-b');
  await simctl('ui', id, 'appearance', 'dark');
  await simctl('install', id, APP);
  return id;
}

const maestro = (device: string, flow: string, env: Record<string, string>) =>
  spawn(MAESTRO, ['--device', device, 'test', ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), join(HERE, flow)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const finished = (p: ChildProcess, what: string) =>
  new Promise<void>((resolve, reject) => {
    let log = '';
    p.stdout?.on('data', (b) => (log += b));
    p.stderr?.on('data', (b) => (log += b));
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${what} failed:\n${log.slice(-3000)}`))));
  });

const created: string[] = [];
test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
  expect(existsSync(APP), `no app at ${APP}: make.sh builds it`).toBe(true);
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

test('demo', async ({ request }, info) => {
  const lang = info.project.name as keyof typeof W;
  const w = W[lang];
  expect((await api(request, 'POST', '/api/auth/password', { username: 'alice', password: 'correct horse battery' })).ok()).toBe(true);
  // Ending a session keeps it as past; deleting it then takes it off the list.
  for (let pass = 0; pass < 2; pass++)
    for (const s of await (await api(request, 'GET', '/api/m/local/sessions')).json()) await api(request, 'DELETE', `/api/m/local/sessions/${s.id}`);

  const blog = await session(request, 'blog');
  writeFileSync(blog.transcript, [rec.user(w.post), rec.claude({ type: 'text', text: w.postReply }), rec.title(w.titles.post)].map(line).join(''));
  await hook(blog.id, 'UserPromptSubmit');
  await hook(blog.id, 'Stop');
  const apiS = await session(request, 'api-server');
  writeFileSync(apiS.transcript, [rec.user(w.rateLimit), rec.title(w.titles.rateLimit)].map(line).join(''));
  await hook(apiS.id, 'UserPromptSubmit');
  const weather = await session(request, 'weather-app');
  writeFileSync(weather.transcript, [rec.user(w.old), rec.claude({ type: 'text', text: w.oldReply }), rec.title(w.titles.button)].map(line).join(''));
  await hook(weather.id, 'UserPromptSubmit');
  await hook(weather.id, 'Stop');

  // The story flow asks here for its pauses and marks its captions, so the timing is this test's.
  let t0 = 0;
  const marks: { t: number; cap: number }[] = [];
  let end = 0;
  const now = () => (Date.now() - t0) / 1000;
  const cap = (n: number) => marks.push({ t: now(), cap: n });
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const server = createServer(async (req, res) => {
    const [, what, arg] = (req.url ?? '').split('/');
    if (what === 'wait') await pause(Number(arg));
    else if (what === 'cap') cap(Number(arg));
    else if (what === 'end') end = now();
    res.end('ok');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const MARKS = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const device = await makeDevice(lang);
  const video = join(OUT, `phone-${lang}.mp4`);
  let recorder: ChildProcess | undefined;
  try {
    const env = {
      APP_ID,
      MARKS,
      SERVER: ORIGIN,
      USERNAME: 'alice',
      PASSWORD: 'correct horse battery',
      LOGIN: w.ui.login,
      NOT_NOW: w.ui.notNow,
      OPEN: w.titles.button,
      OLD_REPLY: w.oldReply,
      ASK: w.ask,
      SEND: w.ui.send,
      OPTION: w.options[1][0],
      SUBMIT: w.ui.submit,
      DONE: w.ui.done,
    };
    await finished(maestro(device, 'signin.yaml', env), 'signing in');

    recorder = spawn('xcrun', ['simctl', 'io', device, 'recordVideo', '--codec', 'h264', '--force', video], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((resolve) => recorder!.stderr!.on('data', (b) => String(b).includes('Recording started') && resolve()));
    t0 = Date.now();
    const story = finished(maestro(device, 'story.yaml', env), 'the story');

    const claude = (async () => {
      // The app types the message into the session's terminal; once it shows there, Claude takes it.
      const screen = async () => ((await (await api(request, 'GET', `/api/m/local/sessions/${weather.id}/screen`)).json()) as { text: string }).text;
      await expect.poll(screen, { timeout: 120_000 }).toContain(w.ask.slice(0, 12));
      const add = (r: unknown) => appendFileSync(weather.transcript, line(r));
      await pause(300);
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
      await api(request, 'POST', `/api/m/local/sessions/${weather.id}/keys`, { keys: `clear; sh ${picker}\r` });
      await expect.poll(screen).toContain(w.options[2][0]);
      await hook(weather.id, 'Notification');
      // The picker takes the answer and leaves; only then does Claude go on.
      await expect.poll(screen, { timeout: 120_000 }).not.toContain(w.options[2][0]);
      await hook(weather.id, 'PostToolUse');
      await pause(1500);
      add(rec.claude({ type: 'text', text: w.done }));
      await hook(weather.id, 'Stop');
    })();
    // Either one failing ends the run, the other's error aside.
    await Promise.all([story, claude]);
  } finally {
    if (recorder) {
      const written = new Promise((r) => recorder!.on('exit', r));
      recorder.kill('SIGINT');
      await written;
    }
    server.close();
    await simctl('shutdown', device).catch(() => {});
    await simctl('delete', device).catch(() => {});
  }

  expect(marks.map((m) => m.cap)).toEqual([0, 1, 2, 3, 4]);
  expect(end).toBeGreaterThan(marks[4].t);
  // The app's part of the screen, between the status bar and the home indicator, at 15 frames a second; times are
  // from the first caption, as compose.py takes them.
  const dir = join(OUT, `frames-${lang}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', video]);
  const [width, height] = stdout.trim().split(',').map(Number);
  const px = width / 440;
  expect(height / px).toBe(956);
  const FPS = 15;
  await run('ffmpeg', ['-loglevel', 'error', '-i', video, '-vf', `crop=${width}:${(956 - 54 - 34) * px}:0:${54 * px},scale=840:-2,fps=${FPS}`, '-q:v', '3', '-start_number', '0', join(dir, '%04d.jpg')]);
  const count = (await run('sh', ['-c', `ls '${dir}' | grep -c jpg`])).stdout.trim();
  const start = marks[0].t;
  writeFileSync(join(dir, 'times.json'), JSON.stringify(Array.from({ length: Number(count) }, (_, k) => k / FPS - start)));
  writeFileSync(join(OUT, `app-${lang}.json`), JSON.stringify({ marks: marks.map((m) => ({ ...m, t: m.t - start })), end: end - start, caps: w.cap }));
  rmSync(video);
});
