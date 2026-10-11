import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalMachine } from '../../../src/sessions/machine.js';
import { Store } from '../../../src/system/store.js';
import { machineSetup } from '../../helpers/machine.js';

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

// A conversation open in a terminal, at `status` as Claude Code says, whose transcript has `lines`.
const open = async (status: string, lines: unknown[] | null) => {
  const root = mkdtempSync(join(dir, 'p-'));
  const sid = randomUUID();
  const cwd = mkdtempSync(join(dir, 'c-'));
  if (lines) {
    mkdirSync(join(root, 'here'));
    writeFileSync(join(root, 'here', `${sid}.jsonl`), lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  }
  writeFileSync(LIST, JSON.stringify([{ pid: await runs(), sessionId: sid, cwd, kind: 'interactive', status }]));
  const store = new Store(join(mkdtempSync(join(dir, 's-')), 'state.json'));
  const m = new LocalMachine({
    tmux,
    store,
    claudeSettingsPath: '/dev/null',
    claudeBin: fakeClaude,
    shell: '/bin/sh',
    claudeProjectsRoot: root,
    journal: { file: join(dir, `${sid}.db`), log: () => {} },
  });
  return { m, sid, cwd };
};

describe('a conversation open on the Mac', () => {
  it.each<[string, string, unknown[] | null, string]>([
    ['busy with its turn over has only commands left running', 'busy', [SAID, OVER], 'background'],
    ['busy with its turn going on is busy', 'busy', [SAID, OVER, { type: 'user', message: { content: 'more' } }, CALLING], 'busy'],
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
    const { m, sid, cwd } = await open('busy', [SAID, OVER, { type: 'user', message: { content: 'more' } }, CALLING]);
    expect(await m.takeOverWhenIdle({ kind: 'claude', cwd, resumeId: sid })).toBeNull();
    expect(m.takingOver(sid)).toBe(true);
    m.cancelTakeOver(sid);
  });
});
