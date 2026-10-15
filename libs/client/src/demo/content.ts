import type { ChatItem, Diff } from '../model/chat';

// What the demo's Mac holds, made up: two projects, a Claude session that is done, one that works while it is
// looked at, and a Codex session.

// One thing Claude does, `after` ms from the one before it: a turn it writes, what its live line says, how many
// of its tasks are done.
export type Step = { after: number; item?: ChatItem; live?: string | null; tasksDone?: number };

export type DemoSessionText = { title: string; cwd: string; items: ChatItem[] };

export type DemoText = {
  folders: string[];
  done: DemoSessionText & { subagent: { id: string; description: string; items: ChatItem[] } };
  busy: DemoSessionText & { tasks: string[]; steps: Step[] };
  codex: DemoSessionText;
  // How a message sent in the demo is answered.
  reply: (text: string) => Step[];
};

const SHOP = '~/Projects/shop-app';
const BLOG = '~/Projects/blog';

const loginDiff: Diff = {
  file: 'src/pages/Login.tsx',
  added: 2,
  removed: 1,
  hunks: [{ oldStart: 41, newStart: 41, lines: ['   <button', '-    style={{ borderRadius: 4 }}', '+    style={{ borderRadius: 12 }}', '+    className="primary"', '   >'] }],
};
const signupDiff: Diff = {
  file: 'src/pages/Signup.tsx',
  added: 1,
  removed: 1,
  hunks: [{ oldStart: 28, newStart: 28, lines: ['   <button', '-    style={{ borderRadius: 4 }}', '+    style={{ borderRadius: 12 }}', '   >'] }],
};

const tool = (id: string, name: string, summary: string, input?: string): ChatItem => ({ k: 'tool', id, name, summary, ...(input && { input }) });
const result = (id: string, text: string, diff?: Diff): ChatItem => ({ k: 'result', id, text, error: false, ...(diff && { diff }) });

const zh: DemoText = {
  folders: [SHOP, BLOG],
  done: {
    title: '登录按钮改成圆角',
    cwd: SHOP,
    items: [
      { k: 'user', text: '把登录页的按钮改成 12px 圆角，注册页如果也有一样的按钮就一起改' },
      { k: 'text', text: '先看一下登录页现在的样式。' },
      tool('d1', 'Read', `${SHOP}/src/pages/Login.tsx`),
      result('d1', '…\n  <button\n    style={{ borderRadius: 4 }}\n  >\n…'),
      tool('d2', 'Edit', `${SHOP}/src/pages/Login.tsx`),
      result('d2', 'ok', loginDiff),
      tool('toolu_demo_agent', 'Agent', '找别处一样的按钮', '在 src/ 里找所有写死 borderRadius: 4 的按钮，列出文件和行号。'),
      result('toolu_demo_agent', '找到 1 处：src/pages/Signup.tsx:29'),
      tool('d3', 'Edit', `${SHOP}/src/pages/Signup.tsx`),
      result('d3', 'ok', signupDiff),
      tool('d4', 'Bash', '跑一遍按钮相关的测试', 'pnpm test -- --run src/pages'),
      result('d4', '✓ src/pages/Login.test.tsx (4)\n✓ src/pages/Signup.test.tsx (3)\n\nTests  7 passed (7)'),
      { k: 'text', text: '改好了：\n\n- 登录页按钮改成 **12px 圆角**，顺手加了 `primary` 样式；\n- 注册页有一个一样的按钮，也一起改了；\n- 相关的 7 个测试都通过。' },
    ],
    subagent: {
      id: 'toolu_demo_agent',
      description: '找别处一样的按钮',
      items: [
        { k: 'user', text: '在 src/ 里找所有写死 borderRadius: 4 的按钮，列出文件和行号。' },
        tool('s1', 'Grep', 'borderRadius: 4', 'grep -rn "borderRadius: 4" src'),
        result('s1', 'src/pages/Login.tsx:42:    style={{ borderRadius: 4 }}\nsrc/pages/Signup.tsx:29:    style={{ borderRadius: 4 }}'),
        { k: 'text', text: '登录页那处已经在改了，另外找到 1 处：`src/pages/Signup.tsx:29`。' },
      ],
    },
  },
  busy: {
    title: '修 CI 里挂掉的测试',
    cwd: BLOG,
    items: [
      { k: 'user', text: 'CI 上 build 挂了，帮我看看怎么回事并修好' },
      { k: 'text', text: '我先在本地复现，再找原因。' },
    ],
    tasks: ['在本地复现失败', '找到原因', '修好并重新跑测试'],
    steps: [
      { after: 2500, item: tool('b1', 'Bash', '复现 CI 的失败', 'pnpm build'), live: '正在跑 pnpm build…' },
      { after: 3500, item: { k: 'result', id: 'b1', text: "error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.\n  src/feed.ts:18", error: true }, live: null, tasksDone: 1 },
      { after: 3000, item: tool('b2', 'Read', `${BLOG}/src/feed.ts`) },
      { after: 2000, item: result('b2', 'const date = post.publishedAt;\nformatDate(date);') },
      { after: 3000, item: { k: 'text', text: '原因：`publishedAt` 可能是空的（草稿没有发布日期），新版的类型检查把它报出来了。' }, tasksDone: 2 },
      { after: 3000, item: tool('b3', 'Edit', `${BLOG}/src/feed.ts`) },
      { after: 1500, item: result('b3', 'ok', { file: 'src/feed.ts', added: 1, removed: 1, hunks: [{ oldStart: 17, newStart: 17, lines: ['-const posts = all;', '+const posts = all.filter((p) => p.publishedAt);'] }] }) },
      { after: 2500, item: tool('b4', 'Bash', '重新构建并跑测试', 'pnpm build && pnpm test'), live: '正在跑 pnpm build && pnpm test…' },
      { after: 4000, item: result('b4', 'build ok\nTests  23 passed (23)'), live: null, tasksDone: 3 },
      { after: 2000, item: { k: 'text', text: '修好了：订阅源里先过滤掉没有发布日期的草稿。构建和 23 个测试都通过，可以推了。' } },
    ],
  },
  codex: {
    title: '写一个部署脚本',
    cwd: BLOG,
    items: [
      { k: 'user', text: '写个 deploy.sh：构建后把 dist 同步到服务器' },
      tool('c1', 'Bash', '看看现在的构建输出在哪', 'cat package.json | grep build'),
      result('c1', '"build": "vite build --outDir dist"'),
      { k: 'text', text: '写好了 `deploy.sh`：先 `pnpm build`，再用 `rsync -az --delete dist/` 同步过去。服务器地址从环境变量 `DEPLOY_HOST` 读。' },
    ],
  },
  reply: (text) => [
    { after: 1200, live: '正在想…' },
    { after: 1500, item: tool('r1', 'Bash', '看看改了哪些文件', 'git status --short'), live: null },
    { after: 1500, item: result('r1', ' M src/pages/Login.tsx\n M src/pages/Signup.tsx') },
    {
      after: 2000,
      item: { k: 'text', text: `（这是演示）收到：「${text}」。\n\n连上你自己的 Mac 之后，这里是 Mac 上的 Claude Code 在干活、在回答，你在手机上看着它、跟它说话。` },
    },
  ],
};

const en: DemoText = {
  folders: [SHOP, BLOG],
  done: {
    title: 'Round the login button',
    cwd: SHOP,
    items: [
      { k: 'user', text: "Give the login page's button 12px rounded corners, and the sign-up page's too if it has the same one" },
      { k: 'text', text: "Let me look at the login page's style first." },
      tool('d1', 'Read', `${SHOP}/src/pages/Login.tsx`),
      result('d1', '…\n  <button\n    style={{ borderRadius: 4 }}\n  >\n…'),
      tool('d2', 'Edit', `${SHOP}/src/pages/Login.tsx`),
      result('d2', 'ok', loginDiff),
      tool('toolu_demo_agent', 'Agent', 'Find the same button elsewhere', 'Find every button in src/ with a hard-coded borderRadius: 4, with file and line.'),
      result('toolu_demo_agent', 'Found 1 more: src/pages/Signup.tsx:29'),
      tool('d3', 'Edit', `${SHOP}/src/pages/Signup.tsx`),
      result('d3', 'ok', signupDiff),
      tool('d4', 'Bash', 'Run the button tests', 'pnpm test -- --run src/pages'),
      result('d4', '✓ src/pages/Login.test.tsx (4)\n✓ src/pages/Signup.test.tsx (3)\n\nTests  7 passed (7)'),
      { k: 'text', text: "Done:\n\n- The login button has **12px rounded corners** now, and the `primary` style;\n- the sign-up page had the same button, changed too;\n- the 7 tests around them pass." },
    ],
    subagent: {
      id: 'toolu_demo_agent',
      description: 'Find the same button elsewhere',
      items: [
        { k: 'user', text: 'Find every button in src/ with a hard-coded borderRadius: 4, with file and line.' },
        tool('s1', 'Grep', 'borderRadius: 4', 'grep -rn "borderRadius: 4" src'),
        result('s1', 'src/pages/Login.tsx:42:    style={{ borderRadius: 4 }}\nsrc/pages/Signup.tsx:29:    style={{ borderRadius: 4 }}'),
        { k: 'text', text: 'The login page one is being changed already; there is 1 more: `src/pages/Signup.tsx:29`.' },
      ],
    },
  },
  busy: {
    title: 'Fix the failing CI build',
    cwd: BLOG,
    items: [
      { k: 'user', text: 'The build fails on CI, find out why and fix it' },
      { k: 'text', text: "I'll reproduce it here first, then look for the cause." },
    ],
    tasks: ['Reproduce the failure', 'Find the cause', 'Fix it and run the tests again'],
    steps: [
      { after: 2500, item: tool('b1', 'Bash', "Reproduce CI's failure", 'pnpm build'), live: 'Running pnpm build…' },
      { after: 3500, item: { k: 'result', id: 'b1', text: "error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.\n  src/feed.ts:18", error: true }, live: null, tasksDone: 1 },
      { after: 3000, item: tool('b2', 'Read', `${BLOG}/src/feed.ts`) },
      { after: 2000, item: result('b2', 'const date = post.publishedAt;\nformatDate(date);') },
      { after: 3000, item: { k: 'text', text: 'The cause: `publishedAt` can be empty (a draft has no date), which the newer type check now reports.' }, tasksDone: 2 },
      { after: 3000, item: tool('b3', 'Edit', `${BLOG}/src/feed.ts`) },
      { after: 1500, item: result('b3', 'ok', { file: 'src/feed.ts', added: 1, removed: 1, hunks: [{ oldStart: 17, newStart: 17, lines: ['-const posts = all;', '+const posts = all.filter((p) => p.publishedAt);'] }] }) },
      { after: 2500, item: tool('b4', 'Bash', 'Build and run the tests again', 'pnpm build && pnpm test'), live: 'Running pnpm build && pnpm test…' },
      { after: 4000, item: result('b4', 'build ok\nTests  23 passed (23)'), live: null, tasksDone: 3 },
      { after: 2000, item: { k: 'text', text: 'Fixed: the feed leaves out drafts with no date. The build and all 23 tests pass, ready to push.' } },
    ],
  },
  codex: {
    title: 'Write a deploy script',
    cwd: BLOG,
    items: [
      { k: 'user', text: 'Write a deploy.sh that builds and syncs dist to the server' },
      tool('c1', 'Bash', 'See where the build goes', 'cat package.json | grep build'),
      result('c1', '"build": "vite build --outDir dist"'),
      { k: 'text', text: '`deploy.sh` is written: `pnpm build`, then `rsync -az --delete dist/` to the server, whose address it reads from `DEPLOY_HOST`.' },
    ],
  },
  reply: (text) => [
    { after: 1200, live: 'Thinking…' },
    { after: 1500, item: tool('r1', 'Bash', 'See which files changed', 'git status --short'), live: null },
    { after: 1500, item: result('r1', ' M src/pages/Login.tsx\n M src/pages/Signup.tsx') },
    {
      after: 2000,
      item: { k: 'text', text: `(This is the demo.) Got it: "${text}".\n\nWith your own Mac connected, this is Claude Code on the Mac at work and answering, while you watch and talk to it from your phone.` },
    },
  ],
};

export const demoText = (lang: 'en' | 'zh'): DemoText => (lang === 'zh' ? zh : en);
