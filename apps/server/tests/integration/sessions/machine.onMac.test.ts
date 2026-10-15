import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalMachine } from '../../../src/sessions/machine.js';
import { Store } from '../../../src/system/store.js';
import { machineSetup } from '../../helpers/machine.js';
import { until } from '../../helpers/until.js';

// A conversation open in a terminal on the Mac is at work while its turn goes on: once the turn is over, what
// Claude Code still calls busy is only commands it left running, and waiting for its step to be done is over.
const { dir, tmux } = machineSetup('onmac');

// A Claude as Claude Code lists it, run as a program of the test's own, and a claude that lists it.
const LIST = join(dir, 'agents.json');
const fakeClaude = join(dir, 'claude-lists');
writeFileSync(fakeClaude, `#!/bin/sh\nif [ "$1" = agents ]; then cat ${JSON.stringify(LIST)}; exit 0; fi\nexec sleep 30\n`);
chmodSync(fakeClaude, 0o755);

const started: ChildProcess[] = [];
afterEach(() => {
  for (const p of started.splice(0)) {
    try {
      process.kill(p.pid!, 'SIGKILL');
    } catch {
      // gone already
    }
  }
});

const runs = async () => {
  const p = spawn(process.execPath, ['-e', "console.log('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/bin:/usr/bin' } });
  started.push(p);
  await new Promise((r) => p.stdout!.once('data', r));
  return p.pid!;
};

const assistant = (content: unknown[]) => ({ type: 'assistant', message: { content } });
const SAID = assistant([{ type: 'text', text: 'Done.' }]);
const OVER = { type: 'system', subtype: 'stop_hook_summary', timestamp: '2026-10-11T09:19:15.230Z' };
const CALLING = assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]);
const HELD = { type: 'queue-operation', operation: 'enqueue', content: 'and then this' };
const GOING = [SAID, OVER, { type: 'user', message: { content: 'more' } }, CALLING];

// A conversation open in a terminal, at `status` as Claude Code says, whose transcript has `lines`; `machine`
// makes one on the same store again, the way the server starts after a restart.
const open = async (status: string, lines: unknown[] | null) => {
  const root = mkdtempSync(join(dir, 'p-'));
  const sid = randomUUID();
  const cwd = mkdtempSync(join(dir, 'c-'));
  const transcript = join(root, 'here', `${sid}.jsonl`);
  if (lines) {
    mkdirSync(join(root, 'here'));
    writeFileSync(transcript, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  }
  writeFileSync(LIST, JSON.stringify([{ pid: await runs(), sessionId: sid, cwd, kind: 'interactive', status }]));
  const store = new Store(join(mkdtempSync(join(dir, 's-')), 'state.json'));
  const machine = () =>
    new LocalMachine({
      tmux,
      store,
      claudeSettingsPath: '/dev/null',
      claudeBin: fakeClaude,
      shell: '/bin/sh',
      claudeProjectsRoot: root,
      journal: { file: join(dir, `${sid}.db`), log: () => {} },
    });
  const writes = (line: unknown) => appendFileSync(transcript, `${JSON.stringify(line)}\n`);
  return { m: machine(), machine, store, sid, cwd, writes };
};

describe('a conversation open on the Mac', () => {
  it.each<[string, string, unknown[] | null, string]>([
    ['busy with its turn over has only commands left running', 'busy', [SAID, OVER], 'background'],
    ['busy with its turn going on is busy', 'busy', GOING, 'busy'],
    ['busy with its turn over and a message in its queue is busy', 'busy', [SAID, OVER, HELD], 'busy'],
    ['busy with no transcript to say is busy', 'busy', null, 'busy'],
    ['asking with its turn over is asking', 'waiting', [SAID, OVER], 'waiting'],
    ['idle is idle', 'idle', [SAID, OVER], 'idle'],
  ])('%s', async (_, said, lines, status) => {
    const { m, sid } = await open(said, lines);
    expect((await m.openOnMac()).get(sid)?.status).toBe(status);
  });

  it('is taken over at once when its turn is over, whatever it left running', async () => {
    const { m, sid, cwd } = await open('busy', [SAID, OVER]);
    const made = await m.takeOverWhenIdle({ kind: 'claude', cwd, resumeId: sid });
    expect(made).toMatchObject({ claudeSessionId: sid });
    await m.killSession(made!.id);
  });

  it('is waited on while its turn goes on', async () => {
    const { m, sid, cwd } = await open('busy', GOING);
    expect(await m.takeOverWhenIdle({ kind: 'claude', cwd, resumeId: sid })).toBeNull();
    expect(m.takingOver(sid)).toBe(true);
    m.cancelTakeOver(sid);
  });
});

// Whether it is open there is asked of Claude Code; when it does not answer, it may be, and is not gone on with here.
describe('a conversation the Mac does not say is open or not', () => {
  const hangs = join(dir, 'claude-hangs');
  writeFileSync(hangs, '#!/bin/sh\nexec sleep 30\n');
  chmodSync(hangs, 0o755);

  it.each<[string, (m: LocalMachine, spec: { kind: 'claude'; cwd: string; resumeId: string }) => Promise<unknown>]>([
    ['going on with it', (m, spec) => m.createSession(spec)],
    ['taking it over now', (m, spec) => m.createSession({ ...spec, takeOver: true })],
    ['taking it over once its turn is over', (m, spec) => m.takeOverWhenIdle(spec)],
  ])('is not resumed on %s', async (_, ask) => {
    const m = new LocalMachine({
      tmux,
      store: new Store(join(mkdtempSync(join(dir, 's-')), 'state.json')),
      claudeSettingsPath: '/dev/null',
      claudeBin: hangs,
      shell: '/bin/sh',
      claudeProjectsRoot: mkdtempSync(join(dir, 'p-')),
      journal: { file: join(dir, `${randomUUID()}.db`), log: () => {} },
    });
    await expect(ask(m, { kind: 'claude', cwd: mkdtempSync(join(dir, 'c-')), resumeId: randomUUID() })).rejects.toMatchObject({ status: 409, code: 'mac-unanswered' });
    expect(await m.listSessions()).toEqual([]);
  }, 20_000);
});

// The server restarts with every update: what it waits for is on disk, not only in memory.
describe('a take-over waited on', () => {
  const opened = async (m: LocalMachine, sid: string) => (await m.listSessions()).find((x) => x.claudeSessionId === sid);

  it('is waited on still after a restart, and goes ahead once the turn is over', async () => {
    const { m, machine, sid, cwd, writes } = await open('busy', GOING);
    expect(await m.takeOverWhenIdle({ kind: 'claude', cwd, resumeId: sid })).toBeNull();
    m.closeJournal();
    const again = machine();
    expect(again.takingOver(sid)).toBe(true);
    writes(SAID);
    writes(OVER);
    expect(await until(async () => !!(await opened(again, sid)), 10_000)).toBe(true);
    expect(await until(() => !again.takingOver(sid))).toBe(true);
    await again.killSession((await opened(again, sid))!.id);
    again.closeJournal();
    expect(machine().takingOver(sid)).toBe(false);
  }, 20_000);

  it('is not waited on after a restart once it was stopped', async () => {
    const { m, machine, sid, cwd } = await open('busy', GOING);
    await m.takeOverWhenIdle({ kind: 'claude', cwd, resumeId: sid });
    m.cancelTakeOver(sid);
    m.closeJournal();
    expect(machine().takingOver(sid)).toBe(false);
  });

  it('is not waited on after a restart past the time it was waited on for', async () => {
    const { m, machine, sid, cwd } = await open('busy', GOING);
    const realNow = Date.now;
    await m.takeOverWhenIdle({ kind: 'claude', cwd, resumeId: sid });
    m.closeJournal();
    try {
      Date.now = () => realNow() + 13 * 3600_000;
      expect(machine().takingOver(sid)).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });
});
