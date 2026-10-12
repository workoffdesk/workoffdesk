import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeAccounts } from '../../src/agents/claude/accounts.js';
import { hashPassword } from '../../src/http/auth/password.js';
import { parseConfig } from '../../src/system/config.js';
import { startServer } from '../../src/http/serve.js';
import { Store } from '../../src/system/store.js';
import { Tmux } from '../../src/system/tmux.js';

// The same wiring `workoffdesk serve` uses, with a throwaway home, a private tmux
// socket, a fake claude and a push sender that goes nowhere.

// npx/pnpm leak npm_* variables that the user's shell profile reacts to (nvm warns).
for (const k of Object.keys(process.env)) if (k.startsWith('npm_')) delete process.env[k];

const port = Number(process.env.E2E_PORT);
const home = process.env.E2E_HOME!;
rmSync(home, { recursive: true, force: true });
mkdirSync(join(home, 'project-a'), { recursive: true });
mkdirSync(join(home, 'claude-projects', '-p'), { recursive: true });

// Claude Code's folder, with a skill of the user's, and a command of the project's own.
const claudeDir = join(home, 'claude-config');
mkdirSync(join(claudeDir, 'skills', 'lesson'), { recursive: true });
writeFileSync(join(claudeDir, 'skills', 'lesson', 'SKILL.md'), '---\nname: lesson\ndescription: 把一条经验归档\n---\n');
mkdirSync(join(home, 'project-a', '.claude', 'commands'), { recursive: true });
writeFileSync(join(home, 'project-a', '.claude', 'commands', 'release.md'), '发一个版本\n');

// The Mac's Claude accounts, each signed in and sharing its conversations: the default, and one more.
const accountsHome = join(home, 'accounts');
const account = (dir: string, json: string, email: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.credentials.json'), '{}');
  symlinkSync(join(home, 'claude-projects'), join(dir, 'projects'));
  writeFileSync(json, JSON.stringify({ oauthAccount: { emailAddress: email }, hasCompletedOnboarding: true }));
};
account(join(accountsHome, '.claude'), join(accountsHome, '.claude.json'), 'own@example.com');
account(join(accountsHome, '.claude-work'), join(accountsHome, '.claude-work', '.claude.json'), 'work@example.com');

const fakeClaude = join(home, 'claude');
// Like Claude Code, once at its prompt it runs the SessionStart hook of the settings it is given; while the
// test asks for it with a file `claude-stays`, it then stays at its prompt. The Claudes open in terminals on the
// Mac are what a test writes in `mac-agents.json`.
writeFileSync(
  fakeClaude,
  [
    '#!/bin/sh',
    `[ "$1" = agents ] && { cat ${JSON.stringify(join(home, 'mac-agents.json'))} 2>/dev/null || echo '[]'; exit 0; }`,
    'echo "fake claude $*"',
    'while [ $# -gt 1 ]; do',
    `  [ "$1" = --settings ] && hook=$(${JSON.stringify(process.execPath)} -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).hooks.SessionStart[0].hooks[0].command' "$2")`,
    '  shift',
    'done',
    `[ -n "$hook" ] && echo '{"hook_event_name":"SessionStart"}' | sh -c "$hook"`,
    `[ -f ${JSON.stringify(join(home, 'claude-stays'))} ] && exec sleep 600`,
    '',
  ].join('\n'),
);
chmodSync(fakeClaude, 0o755);
writeFileSync(
  join(home, 'claude-projects', '-p', '3f2a1b4c-0000-4000-8000-000000000001.jsonl'),
  [
    { type: 'user', cwd: join(home, 'project-a'), message: { content: '把登录页的按钮改成圆角' } },
    { type: 'ai-title', aiTitle: '登录页按钮圆角' },
  ]
    .map((r) => JSON.stringify(r))
    .join('\n') + '\n',
);

// A conversation a Claude Code background session holds (~/.claude/jobs), which cannot be resumed here.
const held = join(home, 'claude-projects', '-p', '6e36fce3-f9fd-4ac2-ba5e-50e10fdb01db.jsonl');
writeFileSync(held, `${JSON.stringify({ type: 'user', cwd: join(home, 'project-a'), message: { content: '把博客文章改成图文帖' } })}\n`);
mkdirSync(join(home, 'claude-jobs', '6e36fce3'), { recursive: true });
writeFileSync(join(home, 'claude-jobs', '6e36fce3', 'state.json'), JSON.stringify({ state: 'blocked', linkScanPath: held }));

// Sessions an agent runner (Paperclip) started through the SDK, each woken for an issue of its own.
for (let i = 1; i <= 12; i++) {
  const wake = ['## Paperclip Wake Payload', '', 'Use this wake to continue the task.', '', `- issue: MEM-${700 + i} 自动任务 ${i}`].join('\n');
  writeFileSync(
    join(home, 'claude-projects', '-p', `3f2a1b4c-0000-4000-8000-1000000000${String(i).padStart(2, '0')}.jsonl`),
    `${JSON.stringify({ type: 'user', entrypoint: 'sdk-cli', cwd: join(home, 'project-a'), message: { content: wake } })}\n`,
  );
}

const store = new Store(join(home, 'state.json'));
const hash = await hashPassword('correct horse battery');
store.update((s) => {
  s.user = { username: 'alice', hash };
});
const socket = `workoffdesk-e2e-${port}`;
await new Tmux({ socket, conf: '/dev/null' }).killServer().catch(() => {});

const origin = `http://localhost:${port}`;
const options: Parameters<typeof startServer>[0] = {
  home,
  config: parseConfig({ port, origin, pinnedDirs: [join(home, 'project-a')] }),
  webDir: fileURLToPath(new URL('../../dist/web', import.meta.url)),
  claudeBin: fakeClaude,
  // No Codex: the threads of the Mac it runs on stay out of the test.
  codexBin: null,
  claudeProjectsRoot: join(home, 'claude-projects'),
  claudeJobsRoot: join(home, 'claude-jobs'),
  claudeDir,
  claudeAccounts: new ClaudeAccounts({ home: accountsHome, projectsRoot: join(home, 'claude-projects'), keychainHas: async () => false }),
  // The This Mac page's report: a server launchd does not run, with no releases and nothing to check.
  ops: {
    home,
    managed: false,
    startedAt: Date.now(),
    buildRoot: fileURLToPath(new URL('../..', import.meta.url)),
    doctor: async () => [],
    spawnOp: () => {
      throw new Error('not managed');
    },
  },
  tmuxSocket: socket,
  pushSend: async () => ({ statusCode: 201 }),
  watchMs: 500,
};

// The Mac side restarting, as a deploy does it: the server closes (telling the phones 4012) and a new
// one starts on the same port. Only this test server has the route.
async function boot() {
  const s = await startServer(options);
  s.app.post('/__test/restart', { config: { public: true } }, async (_req, reply) => {
    reply.code(202).send();
    setImmediate(async () => {
      await server.close();
      server = await boot();
    });
    return reply;
  });
  // Fastify binds both ::1 and 127.0.0.1 for 'localhost', whichever the browser picks.
  await s.app.listen({ port, host: 'localhost' });
  return s;
}

let server = await boot();

const shutdown = async () => {
  await server.close();
  await server.tmux.killServer().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
