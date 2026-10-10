import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeAccounts } from '../../../src/agents/claude/accounts.js';
import type { ClaudeStatus } from '../../../src/agents/types.js';
import type { LocalMachine } from '../../../src/sessions/machine.js';
import { RUNS, machineSetup } from '../../helpers/machine.js';
import { until } from '../../helpers/until.js';

const { dir, tmux, argsFile, dirsFile, fakeClaude, make, restarted } = machineSetup('moves');

// A Mac with two accounts that can both be picked: the default, and one in a config dir of its own.
const home = join(dir, 'home');
const projects = join(home, '.claude', 'projects');
mkdirSync(projects, { recursive: true });
const signedUp = (file: string, email: string) => writeFileSync(file, JSON.stringify({ oauthAccount: { emailAddress: email }, hasCompletedOnboarding: true }));
signedUp(join(home, '.claude.json'), 'a@example.com');
const B = join(home, '.claude-b');
mkdirSync(B);
signedUp(join(B, '.claude.json'), 'b@example.com');
symlinkSync(projects, join(B, 'projects'));
const accounts = () => new ClaudeAccounts({ home, projectsRoot: projects, keychainHas: async () => true });

// Claude at its prompt, running each line sent to it; unlike an interactive shell, it quits when asked to.
const AS_SHELL = ['--run', 'while IFS= read -r line; do eval "$line"; done'];
// A Claude that does not quit when asked to.
const STUBBORN = ['--run', `trap '' TERM; while :; do sleep 1; done`];

const panePid = async (id: string) => (await tmux.listSessions()).find((t) => t.name === `wod-${id}`)!.panePid!;
const childrenOf = (pid: number) => {
  try {
    return execFileSync('pgrep', ['-P', String(pid)]).toString().trim().split('\n').map(Number);
  } catch {
    return [];
  }
};
// The account each start of a session's Claude was on, in order: a config dir, or -unset- for the default.
const startsOn = (id: string) =>
  (existsSync(dirsFile) ? readFileSync(dirsFile, 'utf8').split('\n') : []).filter((l) => l.startsWith(`${id} `)).map((l) => l.slice(id.length + 1));

// Its Claude started, wrote down how, and runs.
const started = async (id: string, times = 1) =>
  expect(await until(async () => startsOn(id).length === times && childrenOf(await panePid(id)).length === 1, 8000)).toBe(true);
// A session on the default account, its Claude at its prompt.
const onDefault = async (m: LocalMachine, o: { env?: Record<string, string>; cwd?: string } = {}) => {
  await m.pickClaudeAccount('');
  const s = await m.createSession({ kind: 'claude', cwd: dir, ...o });
  await started(s.id);
  m.setStatus(s.id, 'idle');
  return { id: s.id, sid: s.claudeSessionId! };
};
const machine = (claudeArgs = RUNS) => make({ claudeArgs, claudeAccounts: accounts() });
const moved = async (id: string) => (await started(id, 2), true);

// Every status the session has while f runs, looked at every 50 ms.
const statusesWhile = async (m: LocalMachine, id: string, f: () => Promise<unknown>) => {
  const seen = new Set<ClaudeStatus | null>();
  let on = true;
  const look = (async () => {
    while (on) {
      seen.add((await m.listSessions()).find((s) => s.id === id)?.status ?? null);
      await new Promise((r) => setTimeout(r, 50));
    }
  })();
  await f().finally(() => (on = false));
  await look;
  return seen;
};

describe('LocalMachine, moving open sessions to the account in use', () => {
  it('moves an idle session at once, going on with its conversation on the account picked', async () => {
    const { m, store } = machine();
    const { id, sid } = await onDefault(m);
    await m.pickClaudeAccount(B);
    expect(await m.claudeAccountsView()).toMatchObject({ elsewhere: 1, moving: 0 });
    await m.moveToAccountInUse();
    expect(await moved(id)).toBe(true);
    expect(startsOn(id)).toEqual(['-unset-', B]);
    expect(readFileSync(argsFile, 'utf8').split('\n').slice(0, 2)).toEqual(['--resume', sid]);
    expect(await until(() => store.get().sessions[id].moving === undefined)).toBe(true);
    expect(store.get().sessions[id].claudeDir).toBe(B);
    expect(await m.claudeAccountsView()).toMatchObject({ elsewhere: 0, moving: 0 });
    expect((await m.listSessions()).filter((s) => s.claudeSessionId === sid).map((s) => s.id)).toEqual([id]);
  });

  it('is never taken for ended while its Claude is quit and started again, whatever said it ended', async () => {
    const { m } = machine();
    const { id } = await onDefault(m);
    await m.pickClaudeAccount(B);
    // The moment between the two Claudes, made long enough to be looked at.
    const respawn = tmux.respawnPane;
    tmux.respawnPane = async (...a) => (await new Promise((r) => setTimeout(r, 1500)), respawn.apply(tmux, a));
    try {
      const seen = await statusesWhile(m, id, async () => {
        const pane = await panePid(id);
        await m.moveToAccountInUse();
        expect(await until(() => childrenOf(pane).length === 0)).toBe(true);
        // What SessionEnd says as the first Claude quits.
        m.claudeMayHaveQuit(id);
        expect(await moved(id)).toBe(true);
      });
      expect(seen).not.toContain('ended');
    } finally {
      tmux.respawnPane = respawn;
    }
  });

  it('counts a session as moving from when it is asked to until it runs on the account picked', async () => {
    const { m } = machine();
    const { id } = await onDefault(m);
    await m.pickClaudeAccount(B);
    const respawn = tmux.respawnPane;
    tmux.respawnPane = async (...a) => (await new Promise((r) => setTimeout(r, 1500)), respawn.apply(tmux, a));
    try {
      // Every view until none is moving; the pane is started again only after 1.5 s, so there are several.
      const views = [await m.moveToAccountInUse()];
      while (views.at(-1)!.moving > 0) {
        await new Promise((r) => setTimeout(r, 50));
        views.push(await m.claudeAccountsView());
      }
      expect(views.length).toBeGreaterThan(5);
      expect(new Set(views.slice(0, -1).map((v) => `${v.elsewhere}/${v.moving}`))).toEqual(new Set(['0/1']));
      expect(views.at(-1)).toMatchObject({ elsewhere: 0, moving: 0 });
      expect(await moved(id)).toBe(true);
    } finally {
      tmux.respawnPane = respawn;
    }
  });

  it('moves a session at work only once its turn is over', async () => {
    const { m, store } = machine();
    const { id } = await onDefault(m);
    m.setStatus(id, 'working');
    await m.pickClaudeAccount(B);
    await m.moveToAccountInUse();
    expect(await m.claudeAccountsView()).toMatchObject({ elsewhere: 0, moving: 1 });
    expect(store.get().sessions[id].moving).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    expect(startsOn(id)).toHaveLength(1);
    m.setStatus(id, 'idle');
    expect(await moved(id)).toBe(true);
    expect(startsOn(id)[1]).toBe(B);
  });

  it('moves one asking something only once it is answered and idle', async () => {
    const { m } = machine();
    const { id } = await onDefault(m);
    m.setStatus(id, 'waiting');
    await m.pickClaudeAccount(B);
    await m.moveToAccountInUse();
    await new Promise((r) => setTimeout(r, 500));
    expect(startsOn(id)).toHaveLength(1);
    m.setStatus(id, 'idle');
    expect(await moved(id)).toBe(true);
  });

  it('sends what was sent while it moved once the new Claude has started, not into the shell between them', async () => {
    const { m } = machine(AS_SHELL);
    const { id } = await onDefault(m);
    await m.pickClaudeAccount(B);
    await m.moveToAccountInUse();
    expect(await m.sendMessage(id, 'echo WENT-$((40+2))')).not.toBeNull();
    expect(await moved(id)).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(await m.screenText(id)).not.toContain('WENT-42');
    m.setStatus(id, 'idle');
    expect(await until(async () => (await m.screenText(id)).includes('WENT-42'))).toBe(true);
    expect(startsOn(id)).toHaveLength(2);
  });

  it('lets what waited go first, and moves after the turn it starts', async () => {
    const { m } = machine(AS_SHELL);
    const { id } = await onDefault(m);
    m.setStatus(id, 'waiting');
    expect(await m.sendMessage(id, 'echo FIRST-$((40+2))')).not.toBeNull();
    await m.pickClaudeAccount(B);
    await m.moveToAccountInUse();
    m.setStatus(id, 'idle');
    expect(await until(async () => (await m.screenText(id)).includes('FIRST-42'))).toBe(true);
    expect(m.getStatus(id)).toBe('working');
    expect(startsOn(id)).toHaveLength(1);
    m.setStatus(id, 'idle');
    expect(await moved(id)).toBe(true);
  });

  it('does not move one whose Claude holds a message in its own queue', async () => {
    const { m, store } = machine(AS_SHELL);
    const { id } = await onDefault(m);
    m.setStatus(id, 'working');
    expect(await m.sendMessage(id, 'echo HELD-$((40+2))')).toBeNull();
    expect(m.journal.messages(id).map((q) => q.state)).toEqual(['enqueued']);
    await m.pickClaudeAccount(B);
    await m.moveToAccountInUse();
    m.setStatus(id, 'idle');
    await new Promise((r) => setTimeout(r, 500));
    expect(startsOn(id)).toHaveLength(1);
    expect(store.get().sessions[id].moving).toBe(true);
  });

  it.each<[string, (m: LocalMachine) => Promise<string>]>([
    ['one whose Claude quit', async (m) => {
      const { id } = await onDefault(m);
      process.kill(childrenOf(await panePid(id))[0], 'SIGKILL');
      expect(await until(async () => (await m.listSessions()).find((s) => s.id === id)?.status === 'ended')).toBe(true);
      return id;
    }],
    ['one started from a terminal', async (m) => (await onDefault(m, { env: { TERM_PROGRAM: 'Apple_Terminal' } })).id],
    ['one already on the account', async (m) => {
      await m.pickClaudeAccount(B);
      const s = await m.createSession({ kind: 'claude', cwd: dir });
      await started(s.id);
      m.setStatus(s.id, 'idle');
      return s.id;
    }],
  ])('leaves alone %s, and does not count it', async (_name, open) => {
    const { m, store } = machine();
    const id = await open(m);
    await m.pickClaudeAccount(B);
    expect(await m.moveToAccountInUse()).toMatchObject({ elsewhere: 0, moving: 0 });
    await new Promise((r) => setTimeout(r, 500));
    expect(startsOn(id)).toHaveLength(1);
    expect(store.get().sessions[id].moving).toBeUndefined();
  });

  it('counts one started from a terminal once it is gone on with here', async () => {
    const { m } = machine();
    const { id } = await onDefault(m, { env: { TERM_PROGRAM: 'Apple_Terminal' } });
    process.kill(childrenOf(await panePid(id))[0], 'SIGKILL');
    expect(await until(async () => (await m.listSessions()).find((s) => s.id === id)?.status === 'ended')).toBe(true);
    await m.continueSession(id);
    await started(id, 2);
    m.setStatus(id, 'idle');
    await m.pickClaudeAccount(B);
    expect(await m.claudeAccountsView()).toMatchObject({ elsewhere: 1 });
  });

  it('does not count a session whose folder is gone as on another account, since it cannot move', async () => {
    const { m } = machine();
    const cwd = mkdtempSync(join(dir, 'gone-'));
    await onDefault(m, { cwd });
    await onDefault(m);
    rmSync(cwd, { recursive: true });
    await m.pickClaudeAccount(B);
    expect(await m.claudeAccountsView()).toMatchObject({ elsewhere: 1, moving: 0 });
  });

  it('refuses before any account was picked', async () => {
    const { m } = machine();
    const s = await m.createSession({ kind: 'claude', cwd: dir });
    await started(s.id);
    m.setStatus(s.id, 'idle');
    expect(await m.claudeAccountsView()).toMatchObject({ picked: false, elsewhere: 0, moving: 0 });
    await expect(m.moveToAccountInUse()).rejects.toMatchObject({ code: 'account-none-picked' });
  });

  it('leaves a session whose Claude will not quit as it was', async () => {
    const { m, store } = machine(STUBBORN);
    const { id } = await onDefault(m);
    const claude = childrenOf(await panePid(id))[0];
    await m.pickClaudeAccount(B);
    await m.moveToAccountInUse();
    expect(await until(() => store.get().sessions[id].moving === undefined, 10_000)).toBe(true);
    expect(childrenOf(await panePid(id))).toEqual([claude]);
    expect(startsOn(id)).toHaveLength(1);
    expect(await until(() => m.getStatus(id) === 'idle')).toBe(true);
    expect(await m.claudeAccountsView()).toMatchObject({ elsewhere: 1, moving: 0 });
  }, 15_000);

  it('leaves a session whose folder is gone as it was, since its Claude could not start again there', async () => {
    const { m, store } = machine();
    const cwd = mkdtempSync(join(dir, 'gone-'));
    const { id } = await onDefault(m, { cwd });
    const claude = childrenOf(await panePid(id))[0];
    rmSync(cwd, { recursive: true });
    await m.pickClaudeAccount(B);
    await m.moveToAccountInUse();
    expect(await until(() => store.get().sessions[id].moving === undefined)).toBe(true);
    expect(childrenOf(await panePid(id))).toEqual([claude]);
    expect(startsOn(id)).toHaveLength(1);
    expect(m.getStatus(id)).not.toBe('ended');
  });

  it('does not move one whose account is picked again before its turn is over', async () => {
    const { m, store } = machine();
    const { id } = await onDefault(m);
    m.setStatus(id, 'working');
    await m.pickClaudeAccount(B);
    await m.moveToAccountInUse();
    await m.pickClaudeAccount('');
    m.setStatus(id, 'idle');
    expect(await until(() => store.get().sessions[id].moving === undefined)).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    expect(startsOn(id)).toHaveLength(1);
  });

  it('still moves one marked before the server restarted, once its turn is over', async () => {
    const { m, store } = machine();
    const { id } = await onDefault(m);
    m.setStatus(id, 'working');
    await m.pickClaudeAccount(B);
    await m.moveToAccountInUse();
    const again = restarted(store, { claudeBin: fakeClaude, claudeArgs: RUNS, claudeAccounts: accounts() });
    expect(await again.claudeAccountsView()).toMatchObject({ moving: 1 });
    again.setStatus(id, 'idle');
    expect(await moved(id)).toBe(true);
    expect(startsOn(id)[1]).toBe(B);
  });
});
