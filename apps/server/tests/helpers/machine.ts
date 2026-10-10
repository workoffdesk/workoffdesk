import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect } from 'vitest';
import type { ClaudeAccounts } from '../../src/agents/claude/accounts.js';
import { LocalMachine } from '../../src/sessions/machine.js';
import { Store } from '../../src/system/store.js';
import { testTmux } from './tmux.js';

// Claude running, at its prompt with nothing on screen, until the session is killed.
export const RUNS = ['--run', 'exec sleep 600'];

export const realClaude = [`${process.env.TEST_REAL_HOME}/.local/bin/claude`].find((p) => existsSync(p));

// A folder, a tmux server and a fake claude of the test file's own. When the file's tests are done its tmux is
// killed and nothing it started may be left running.
export function machineSetup(name: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ts-machine-'));
  const { tmux, conf } = testTmux(dir, name);
  const argsFile = join(dir, 'claude-args.txt');
  const fakeClaude = join(dir, 'fake-claude');
  // Each start, by the session it started in.
  const startsFile = join(dir, 'claude-starts.txt');
  // Each start, by the session it started in and the account it started on: its CLAUDE_CONFIG_DIR, or -unset-.
  const dirsFile = join(dir, 'claude-dirs.txt');
  // Says it runs no one when the server asks; otherwise writes down how it was started, then quits, or with
  // `--run <command>` runs that as Claude for as long as it goes.
  writeFileSync(
    fakeClaude,
    [
      '#!/bin/sh',
      `if [ "$1" = agents ]; then echo '[]'; exit 0; fi`,
      `printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
      `echo "alt=$CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN" >> ${JSON.stringify(argsFile)}`,
      `echo "env=$WORKOFFDESK_SESSION" >> ${JSON.stringify(argsFile)}`,
      `echo "$WORKOFFDESK_SESSION" >> ${JSON.stringify(startsFile)}`,
      `echo "$WORKOFFDESK_SESSION \${CLAUDE_CONFIG_DIR--unset-}" >> ${JSON.stringify(dirsFile)}`,
      'run=; prev=; for a in "$@"; do [ "$prev" = --run ] && run=$a; prev=$a; done',
      '[ -n "$run" ] && exec /bin/sh -c "$run"',
      '',
    ].join('\n'),
  );
  chmodSync(fakeClaude, 0o755);

  // The journal beside the store, so a machine made again on the same store finds what was there.
  const journalOf = (store: Store) => ({ file: join(dirname(store.file), 'journal.db'), log: () => {} });
  const make = (o: { claudeArgs?: string[]; claudeProjectsRoot?: string; claudeAccounts?: ClaudeAccounts } = {}) => {
    const store = new Store(join(mkdtempSync(join(dir, 's-')), 'state.json'));
    const m = new LocalMachine({
      tmux,
      store,
      claudeSettingsPath: '/tmp/term site/claude settings.json',
      claudeBin: fakeClaude,
      shell: '/bin/sh',
      claudeArgs: o.claudeArgs,
      claudeProjectsRoot: o.claudeProjectsRoot,
      claudeAccounts: o.claudeAccounts,
      journal: journalOf(store),
    });
    return { m, store };
  };
  // Made again on the same store and journal, the way the server starts after a restart.
  const restarted = (store: Store, o: { claudeBin?: string; claudeArgs?: string[]; claudeAccounts?: ClaudeAccounts } = {}) =>
    new LocalMachine({ tmux, store, claudeSettingsPath: '/dev/null', shell: '/bin/sh', journal: journalOf(store), ...o });

  // Processes left with no parent, running in this file's folder: what a test started that outlived its tmux.
  const orphans = () => {
    const ours = execFileSync('pgrep', ['-P', '1', '-U', String(process.getuid!())]).toString().trim().split('\n');
    // lsof exits 1 when one of them has gone since pgrep listed it; what it says of the rest still holds.
    const lsof = spawnSync('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', ours.join(',')], { encoding: 'utf8' });
    if (lsof.status !== 0 && lsof.status !== 1) throw new Error(`lsof failed: ${lsof.stderr}`);
    const left: number[] = [];
    let pid = 0;
    for (const line of lsof.stdout.split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1));
      else if (line.startsWith('n') && line.slice(1).startsWith(realpathSync(dir))) left.push(pid);
    }
    return left;
  };

  afterAll(async () => {
    await tmux.killServer();
    await new Promise((r) => setTimeout(r, 1000));
    const left = orphans();
    for (const pid of left) process.kill(pid, 'SIGKILL');
    expect(left).toEqual([]);
  });

  return { dir, tmux, conf, argsFile, fakeClaude, startsFile, dirsFile, make, restarted };
}
