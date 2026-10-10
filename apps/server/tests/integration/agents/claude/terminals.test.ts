import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { listMacClaudes, stopMacProcess } from '../../../../src/agents/claude/terminals.js';
import { alive } from '../../../helpers/processes.js';
import { testTmux } from '../../../helpers/tmux.js';

// Every process here is one a test started. The fake claude lists them: the default list when it is asked
// for this server's own Claudes, a config dir's own list when that dir has one.
const dir = mkdtempSync(join(tmpdir(), 'ts-mac-claudes-'));
const LIST = 'workoffdesk-test-agents.json';
const fakeClaude = join(dir, 'claude');
writeFileSync(
  fakeClaude,
  `#!/bin/sh\n[ "$1 $2" = "agents --json" ] || exit 2\nif [ -f "$CLAUDE_CONFIG_DIR/${LIST}" ]; then cat "$CLAUDE_CONFIG_DIR/${LIST}"; else cat ${JSON.stringify(join(dir, LIST))}; fi\n`,
);
chmodSync(fakeClaude, 0o755);
const lists = (agents: unknown, configDir = dir) => writeFileSync(join(configDir, LIST), JSON.stringify(agents));

const started: ChildProcess[] = [];
const kill = (p: ChildProcess) => {
  try {
    process.kill(-p.pid!, 'SIGKILL');
  } catch {
    // gone already
  }
};
afterEach(() => started.splice(0).forEach(kill));

const RUN = "console.log('ready'); setInterval(() => {}, 1000)";
// A program that runs until it is stopped: node (ps shows the environment of none of the system's own
// programs), as `exe` with `args` when given, with `env` as all its environment.
const runs = async (o: { env?: Record<string, string>; exe?: string; args?: string[]; ignoresTerm?: boolean } = {}) => {
  const args = o.args ?? ['-e', o.ignoresTerm ? `process.on('SIGTERM', () => {}); ${RUN}` : RUN];
  const p = spawn(o.exe ?? process.execPath, args, { stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/bin:/usr/bin', ...o.env }, detached: true });
  started.push(p);
  await new Promise((r) => p.stdout!.once('data', r));
  return p.pid!;
};
const gonePid = async () => {
  const p = spawn('/usr/bin/true');
  await new Promise((r) => p.once('exit', r));
  return p.pid!;
};
const agent = (pid: number, o: Record<string, unknown> = {}) => ({ pid, sessionId: `s-${pid}`, cwd: '/Users/someone/app', kind: 'interactive', status: 'idle', ...o });

describe('listMacClaudes', () => {
  it('lists the interactive ones Claude Code lists, each as it says, with its terminal', async () => {
    const [a, b, c] = [await runs(), await runs(), await runs()];
    lists([agent(a), agent(b, { status: 'waiting' }), agent(c, { status: 'thinking hard' })]);
    expect(await listMacClaudes(fakeClaude)).toEqual([
      { pid: a, sessionId: `s-${a}`, cwd: '/Users/someone/app', status: 'idle', tty: null },
      expect.objectContaining({ pid: b, status: 'waiting' }),
      // A status this does not know is taken for busy: a Claude at work is not stopped.
      expect.objectContaining({ pid: c, status: 'busy' }),
    ]);
  });

  it.each<[string, (pid: number) => unknown]>([
    ['one in the background', (pid) => agent(pid, { kind: 'background' })],
    ['one with no conversation', (pid) => agent(pid, { sessionId: undefined })],
    ['one with no folder', (pid) => agent(pid, { cwd: 7 })],
    ['one with no process', (pid) => agent(pid, { pid: String(pid) })],
    ['what is not a Claude', () => 'claude'],
  ])('leaves out %s', async (_, made) => {
    const pid = await runs();
    lists([made(pid)]);
    expect(await listMacClaudes(fakeClaude)).toEqual([]);
  });

  it('leaves out one a WorkOffDesk session runs, as its environment says, and one gone since it was listed', async () => {
    const [mine, open] = [await runs({ env: { WORKOFFDESK_SESSION: 'abcd1234' } }), await runs()];
    lists([agent(mine), agent(await gonePid()), agent(open)]);
    expect((await listMacClaudes(fakeClaude)).map((c) => c.pid)).toEqual([open]);
  });

  // Where a Claude was started with a CLAUDE_CONFIG_DIR of its own, it lists itself there only.
  it.each<[string, (bin: string) => { exe?: string; args: string[] }]>([
    ["Claude Code's own program", (bin) => {
      symlinkSync(process.execPath, join(bin, 'claude'));
      return { exe: join(bin, 'claude'), args: ['-e', RUN] };
    }],
    ['Claude Code from npm, run by node', (bin) => {
      writeFileSync(join(bin, 'claude'), `${RUN}\n`);
      return { args: [join(bin, 'claude')] };
    }],
  ])('finds them also in the config dir of a terminal, for %s', async (_, made) => {
    const configDir = mkdtempSync(join(dir, 'config-'));
    const bin = join(configDir, 'bin');
    mkdirSync(bin);
    const there = await runs({ env: { CLAUDE_CONFIG_DIR: configDir }, ...made(bin) });
    const open = await runs();
    lists([agent(open)]);
    lists([agent(open), agent(there)], configDir);
    expect((await listMacClaudes(fakeClaude)).map((c) => c.pid).sort()).toEqual([open, there].sort());
  });

  it('lists none when Claude Code cannot say', async () => {
    expect(await listMacClaudes(join(dir, 'no-claude-here'))).toEqual([]);
    writeFileSync(join(dir, LIST), 'Unknown command: agents');
    expect(await listMacClaudes(fakeClaude)).toEqual([]);
  });

  it('lists once for everyone who asks while a listing runs', async () => {
    lists([]);
    const [a, b] = [listMacClaudes(fakeClaude), listMacClaudes(fakeClaude)];
    expect(a).toBe(b);
    await a;
    expect(listMacClaudes(fakeClaude)).not.toBe(a);
  });
});

describe('stopMacProcess', () => {
  const { tmux, socket } = testTmux(dir, 'stop');
  afterAll(() => tmux.killServer());
  afterEach(() => vi.useRealTimers());

  it('tells it to quit and waits until it has', async () => {
    const pid = await runs();
    expect(await stopMacProcess({ pid, tty: null }, 'gone to the phone')).toBe(true);
    expect(alive(pid)).toBe(false);
  });

  it('succeeds for one already gone', async () => {
    expect(await stopMacProcess({ pid: await gonePid(), tty: null }, 'gone to the phone')).toBe(true);
  });

  it('gives up on one that will not quit in ten seconds, and leaves it running', async () => {
    const pid = await runs({ ignoresTerm: true });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    const stopping = stopMacProcess({ pid, tty: null }, 'gone to the phone');
    await vi.advanceTimersByTimeAsync(9_000);
    let done: boolean | undefined;
    void stopping.then((r) => (done = r));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_200);
    expect(await stopping).toBe(false);
    expect(alive(pid)).toBe(true);
  });

  // Each line from its start, also in a terminal left as a program that draws the screen leaves it.
  it('says so in the terminal it leaves, line by line', async () => {
    await tmux.newSession('t', { cwd: dir, command: 'stty -opost; echo ready; sleep 60', env: {}, size: { cols: 80, rows: 10 } });
    await vi.waitFor(async () => expect(await tmux.capture('t', 10)).toContain('ready'));
    const tty = execFileSync('tmux', ['-L', socket, 'display', '-p', '-t', '=t:', '#{pane_tty}']).toString().trim();
    expect(tty).toMatch(/^\/dev\/ttys?\d+$/);
    const pid = await runs();
    expect(await stopMacProcess({ pid, tty: tty.slice('/dev/'.length) }, 'Gone to the phone.\nResume it there.')).toBe(true);
    await vi.waitFor(async () => expect(await tmux.capture('t', 10)).toMatch(/^Gone to the phone\.\nResume it there\.$/m));
  });

  it('succeeds also when the terminal went with it', async () => {
    const pid = await runs();
    expect(await stopMacProcess({ pid, tty: 'ttys999' }, 'gone to the phone')).toBe(true);
  });
});
