import { execFile, execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// The hook server lives in this process, so clients must not block the event loop.
const run = (file: string, args: string[], opts: { input?: string; env?: NodeJS.ProcessEnv } = {}) =>
  new Promise<void>((resolve) => {
    const child = execFile(file, args, { env: opts.env ?? process.env }, () => resolve());
    child.stdin?.end(opts.input ?? '');
  });
// What a hook command prints, which Claude Code reads.
const printed = (command: string, input: string, session = 'abc12345') =>
  new Promise<string>((resolve) => {
    const child = execFile('/bin/sh', ['-c', command], { env: { ...process.env, WORKOFFDESK_SESSION: session } }, (_e, out) => resolve(out));
    child.stdin?.end(input);
  });
import type { HeldHook, PermissionPayload } from '../../../../../src/agents/claude/hooks/asks.js';
import { startHookServer, userStatusLine, writeClaudeSettings } from '../../../../../src/agents/claude/hooks/hooks.js';
import { socketDir } from '../../../../helpers/socketDir.js';
import { until } from '../../../../helpers/until.js';

const dir = socketDir('hooks');
const sock = join(dir, 'hooks.sock');
const events: { termId: string; payload: any }[] = [];
let server: Awaited<ReturnType<typeof startHookServer>>;

afterAll(() => server?.close());

// The real PATH, not the tests' (whose claude runs nothing). npx prepends every ancestor node_modules/.bin to
// it, and a stale npm-installed claude in ~/node_modules would shadow the real CLI.
const claudeEnv = (extra: Record<string, string>) => ({
  ...process.env,
  ...extra,
  PATH: (process.env.TEST_REAL_PATH ?? '').split(':').filter((p) => !p.includes('node_modules')).join(':'),
});

const hasClaude = (() => {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore', env: claudeEnv({}) });
    return true;
  } catch {
    return false;
  }
})();

describe('startHookServer', () => {
  it('replaces a stale socket file and restricts it to the owner', async () => {
    writeFileSync(sock, 'stale');
    server = await startHookServer(sock, (termId, payload) => events.push({ termId, payload }));
    expect(statSync(sock).mode & 0o777).toBe(0o600);
  });

  it('receives a payload posted the way the generated hook posts it', async () => {
    const settings = join(dir, 'claude-settings.json');
    writeClaudeSettings(settings, sock);
    const cfg = JSON.parse(readFileSync(settings, 'utf8'));
    const command: string = cfg.hooks.Stop[0].hooks[0].command;
    await run('/bin/sh', ['-c', command], {
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's1' }),
      env: { ...process.env, WORKOFFDESK_SESSION: 'abc12345' },
    });
    expect(await until(() => events.length > 0)).toBe(true);
    expect(events[0]).toEqual({ termId: 'abc12345', payload: { hook_event_name: 'Stop', session_id: 's1' } });
  });

  it('registers every event the status machine understands, the start of each Claude session and its compactions, with a short timeout', () => {
    const cfg = JSON.parse(readFileSync(join(dir, 'claude-settings.json'), 'utf8'));
    const { PermissionRequest, ...rest } = cfg.hooks;
    expect(Object.keys(rest).sort()).toEqual([
      'Notification',
      'PostCompact',
      'PostToolUse',
      'PostToolUseFailure',
      'PreCompact',
      'SessionEnd',
      'SessionStart',
      'Stop',
      'StopFailure',
      'UserPromptSubmit',
    ]);
    for (const groups of Object.values<any>(rest)) expect(groups[0].hooks[0].timeout).toBeLessThanOrEqual(5);
    // A permission prompt waits for an answer from the phone, so its hook is held far longer.
    expect(PermissionRequest[0].hooks[0].timeout).toBeGreaterThan(5);
  });

  // Agent view would move a conversation out of its window into a background session, out of the phone's reach.
  it('turns agent view off', () => {
    const cfg = JSON.parse(readFileSync(join(dir, 'claude-settings.json'), 'utf8'));
    expect(cfg.disableAgentView).toBe(true);
  });

  it('never fails or blocks the hook when workoffdesk is down', () => {
    // A missing socket fails fast and never reaches this process, so a sync call is safe here.
    const cfg = JSON.parse(readFileSync(join(dir, 'claude-settings.json'), 'utf8'));
    const command = cfg.hooks.Stop[0].hooks[0].command.replace(sock, join(dir, 'missing.sock'));
    const t = Date.now();
    execFileSync('/bin/sh', ['-c', command], { input: '{}', env: { ...process.env, WORKOFFDESK_SESSION: 'x' } });
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it('ignores posts without a session header or with a broken body', async () => {
    const before = events.length;
    await run('curl', ['-s', '--max-time', '3', '--unix-socket', sock, '--data-binary', '{}', 'http://localhost/hook']);
    await run('curl', ['-s', '--max-time', '3', '--unix-socket', sock, '-H', 'x-workoffdesk-session: abc', '--data-binary', 'not json', 'http://localhost/hook']);
    expect(events.length).toBe(before);
  });

  describe('with a permission prompt', () => {
    const sockDir = socketDir('perm');
    const permSock = join(sockDir, 'p.sock');
    const asked: { termId: string; payload: PermissionPayload; hook: HeldHook }[] = [];
    let permServer: Awaited<ReturnType<typeof startHookServer>>;
    let command = '';
    afterAll(() => permServer?.close());
    const PROMPT = { hook_event_name: 'PermissionRequest', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } };

    it('holds it until it is answered, and the hook prints the answer', async () => {
      permServer = await startHookServer(permSock, () => {}, () => {}, (termId, payload, hook) => asked.push({ termId, payload, hook }));
      const file = join(sockDir, 'claude-settings.json');
      writeClaudeSettings(file, permSock);
      command = JSON.parse(readFileSync(file, 'utf8')).hooks.PermissionRequest[0].hooks[0].command;
      const out = printed(command, JSON.stringify(PROMPT));
      expect(await until(() => asked.length === 1)).toBe(true);
      expect([asked[0].termId, asked[0].payload]).toEqual(['abc12345', PROMPT]);
      const gone: number[] = [];
      asked[0].hook.onGone(() => gone.push(1));
      const decision = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
      asked[0].hook.reply(decision);
      expect(JSON.parse(await out)).toEqual(decision);
      asked[0].hook.reply({ again: true });
      expect(await until(() => gone.length > 0, 500)).toBe(false);
    });

    it('prints nothing when it is left to the terminal', async () => {
      const out = printed(command, JSON.stringify(PROMPT));
      expect(await until(() => asked.length === 2)).toBe(true);
      asked[1].hook.reply(null);
      expect(await out).toBe('');
    });

    it.each<[string, string, string]>([
      ['no session', JSON.stringify(PROMPT), ''],
      ['a body that is not JSON', 'not json', 'abc12345'],
      ['a body that is not an object', '"allow"', 'abc12345'],
    ])('lets it go at once, unasked, with %s', async (_, body, session) => {
      const before = asked.length;
      const t = Date.now();
      expect(await printed(command, body, session)).toBe('');
      expect(Date.now() - t).toBeLessThan(3000);
      expect(asked).toHaveLength(before);
    });

    it('says when the hook is gone before it was answered', async () => {
      const child = spawn('/bin/sh', ['-c', command], { env: { ...process.env, WORKOFFDESK_SESSION: 'abc12345' }, stdio: ['pipe', 'ignore', 'ignore'], detached: true });
      child.stdin.end(JSON.stringify(PROMPT));
      const before = asked.length;
      expect(await until(() => asked.length === before + 1)).toBe(true);
      const gone: string[] = [];
      asked.at(-1)!.hook.onGone(() => gone.push('gone'));
      process.kill(-child.pid!, 'SIGKILL');
      expect(await until(() => gone.length > 0)).toBe(true);
      expect(gone).toEqual(['gone']);
    });

    it('lets it go at once, unasked, when its session is empty', async () => {
      const before = asked.length;
      const answer = await new Promise<string>((resolve, reject) => {
        const req = request({ socketPath: permSock, path: '/permission', method: 'POST', headers: { 'x-workoffdesk-session': '' } }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.end(JSON.stringify(PROMPT));
      });
      expect(answer).toBe('');
      expect(asked).toHaveLength(before);
    });
  });
});

describe('userStatusLine', () => {
  const settingsWith = (statusLine: unknown) => {
    const file = join(mkdtempSync(join(dir, 'u-')), 'settings.json');
    writeFileSync(file, JSON.stringify({ statusLine }));
    return file;
  };

  it.each<[string, unknown, unknown]>([
    ['a command and its padding', { type: 'command', command: 'echo hi', padding: 2 }, { type: 'command', command: 'echo hi', padding: 2 }],
    ['a command', { type: 'command', command: 'echo hi' }, { type: 'command', command: 'echo hi' }],
    ['a command and a padding that is not a number', { type: 'command', command: 'echo hi', padding: '2' }, { type: 'command', command: 'echo hi' }],
    ['a status line of another kind', { type: 'static', command: 'echo hi' }, undefined],
    ['no command', { type: 'command', command: '' }, undefined],
    ['a command that is not text', { type: 'command', command: ['echo', 'hi'] }, undefined],
    ['none', undefined, undefined],
  ])('reads the status line the user set for Claude Code when they set %s', (_, set, theirs) => {
    expect(userStatusLine(settingsWith(set))).toEqual(theirs);
  });

  it.each([
    ['no settings', () => join(dir, 'nowhere', 'settings.json')],
    ['settings that are not JSON', () => {
      const file = join(mkdtempSync(join(dir, 'u-')), 'settings.json');
      writeFileSync(file, '{ "statusLine": ');
      return file;
    }],
  ])('finds none the user set with %s', (_, file) => {
    expect(userStatusLine(file())).toBeUndefined();
  });

  describe('when installed', () => {
    const sockDir = socketDir('status');
    const statusSock = join(sockDir, 's.sock');
    const statuses: { termId: string; payload: unknown }[] = [];
    let statusServer: Awaited<ReturnType<typeof startHookServer>>;
    afterAll(() => statusServer?.close());
    const installed = (own?: { command: string; padding?: number }, sockPath = statusSock) => {
      const file = join(mkdtempSync(join(dir, 'i-')), 'claude-settings.json');
      writeClaudeSettings(file, sockPath, own && { type: 'command', ...own });
      return JSON.parse(readFileSync(file, 'utf8')).statusLine as { type: string; command: string; padding?: number };
    };
    const INPUT = JSON.stringify({ session_id: 's1', model: { display_name: 'Opus' } });

    it('sends what Claude Code gives it to workoffdesk, and draws nothing of its own', async () => {
      statusServer = await startHookServer(statusSock, () => {}, (termId, payload) => statuses.push({ termId, payload }));
      const line = installed();
      expect(line.type).toBe('command');
      expect(line.padding).toBeUndefined();
      expect(execFileSync('/bin/sh', ['-c', line.command], { input: INPUT, env: { ...process.env, WORKOFFDESK_SESSION: 'abc12345' } }).toString()).toBe('');
      expect(await until(() => statuses.length > 0)).toBe(true);
      expect(statuses[0]).toEqual({ termId: 'abc12345', payload: JSON.parse(INPUT) });
    });

    it("still draws the user's own, given the same, with their padding", async () => {
      const got = join(dir, 'own-got');
      const line = installed({ command: `cat > ${got}; printf 'Opus · 42%%'`, padding: 1 });
      const before = statuses.length;
      expect(line.padding).toBe(1);
      expect(await printed(line.command, INPUT)).toBe('Opus · 42%');
      expect(readFileSync(got, 'utf8')).toBe(INPUT);
      expect(await until(() => statuses.length > before)).toBe(true);
      expect(statuses.at(-1)!.payload).toEqual(JSON.parse(INPUT));
    });

    it("draws the user's own at once when workoffdesk is down", async () => {
      const line = installed({ command: "cat > /dev/null; printf 'drawn'" }, join(sockDir, 'missing.sock'));
      const t = Date.now();
      expect(await printed(line.command, INPUT)).toBe('drawn');
      expect(Date.now() - t).toBeLessThan(3000);
    });
  });
});

describe('writeClaudeSettings', () => {
  // Spends a few tokens of the account claude is signed in with, so it runs only when asked for.
  describe.skipIf(!hasClaude || process.env.WORKOFFDESK_REAL_CLAUDE !== '1')('with the real claude', () => {
    it('fires our hooks through --settings and keeps the user-level hooks too', async () => {
      const settings = join(dir, 'claude-settings.json');
      const fakeSuperset = join(dir, 'superset');
      mkdirSync(join(fakeSuperset, 'hooks'), { recursive: true });
      const marker = join(dir, 'user-hook-fired');
      writeFileSync(join(fakeSuperset, 'hooks', 'notify.sh'), `#!/bin/sh\ncat > /dev/null\ntouch ${marker}\n`);
      chmodSync(join(fakeSuperset, 'hooks', 'notify.sh'), 0o755);
      const sid = randomUUID();
      const before = events.length;
      await new Promise<void>((resolve, reject) =>
        execFile(
          'claude',
          ['-p', 'Reply with the single word: ok', '--session-id', sid, '--settings', settings],
          { cwd: dir, env: claudeEnv({ WORKOFFDESK_SESSION: 'real0001', SUPERSET_HOME_DIR: fakeSuperset }), timeout: 120_000 },
          (err) => (err ? reject(err) : resolve()),
        ),
      );
      expect(await until(() => events.slice(before).some((e) => e.payload.hook_event_name === 'Stop'))).toBe(true);
      const mine = events.slice(before);
      expect(mine.map((e) => e.payload.hook_event_name)).toContain('UserPromptSubmit');
      expect(mine.every((e) => e.termId === 'real0001')).toBe(true);
      expect(mine.every((e) => e.payload.session_id === sid)).toBe(true);
      expect(existsSync(marker)).toBe(true);
    }, 150_000);
  });
});
