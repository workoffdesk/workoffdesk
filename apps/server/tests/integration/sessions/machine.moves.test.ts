import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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

// A claude that lists, as open in a terminal on the Mac, what LIST says, and otherwise is the fake claude.
const LIST = join(dir, 'mac-agents.json');
const listing = join(dir, 'claude-listing');
writeFileSync(listing, `#!/bin/sh\nif [ "$1" = agents ]; then cat ${JSON.stringify(LIST)} 2>/dev/null || echo '[]'; exit 0; fi\nexec ${JSON.stringify(fakeClaude)} "$@"\n`);
chmodSync(listing, 0o755);
const macClaudes: ChildProcess[] = [];
afterEach(() => {
  rmSync(LIST, { force: true });
  for (const p of macClaudes.splice(0)) p.kill('SIGKILL');
});
// A Claude in a terminal on the Mac, holding the conversation sid, at status.
const openOnMac = async (sid: string, status: string) => {
  const p = spawn(process.execPath, ['-e', "console.log('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/bin:/usr/bin' } });
  macClaudes.push(p);
  await new Promise((r) => p.stdout!.once('data', r));
  writeFileSync(LIST, JSON.stringify([{ pid: p.pid, sessionId: sid, cwd: dir, kind: 'interactive', status }]));
  return p;
};
const alive = (p: ChildProcess) => p.exitCode === null && p.signalCode === null;

describe('LocalMachine, moving the one session asked for to the account in use', () => {
  const listingMachine = (claudeArgs = RUNS) => make({ claudeArgs, claudeAccounts: accounts(), claudeBin: listing });

  it('moves one started from a terminal, keeping what its terminal set but its account', async () => {
    const { m, store } = machine(AS_SHELL);
    const { id, sid } = await onDefault(m, { env: { TERM_PROGRAM: 'Apple_Terminal', FROM_TERMINAL: 'kept', CLAUDE_CONFIG_DIR: join(home, '.claude') } });
    await m.pickClaudeAccount(B);
    const s = await m.moveThis(id);
    expect(s.id).toBe(id);
    await started(id, 2);
    expect(startsOn(id)).toEqual([join(home, '.claude'), B]);
    expect(readFileSync(argsFile, 'utf8').split('\n').slice(0, 2)).toEqual(['--resume', sid]);
    expect(store.get().sessions[id]).toMatchObject({ claudeDir: B });
    expect(store.get().sessions[id].terminal).toBeUndefined();
    m.setStatus(id, 'idle');
    await m.sendMessage(id, 'echo GOT-$FROM_TERMINAL');
    m.setStatus(id, 'idle');
    expect(await until(async () => (await m.screenText(id)).includes('GOT-kept'))).toBe(true);
  });

  it('moves one started here at once, and answers once it runs on the account', async () => {
    const { m, store } = machine();
    const { id } = await onDefault(m);
    await m.pickClaudeAccount(B);
    await m.moveThis(id);
    await started(id, 2);
    expect(startsOn(id)).toEqual(['-unset-', B]);
    expect(store.get().sessions[id].claudeDir).toBe(B);
  });

  it('does nothing for one already on the account in use', async () => {
    const { m } = machine();
    const { id } = await onDefault(m);
    expect((await m.moveThis(id)).id).toBe(id);
    await new Promise((r) => setTimeout(r, 300));
    expect(startsOn(id)).toHaveLength(1);
  });

  it.each<[string, string, (m: LocalMachine, id: string) => Promise<void> | void]>([
    ['while it works', 'session-busy', (m, id) => m.setStatus(id, 'working')],
    ['while it asks something', 'session-busy', (m, id) => m.setStatus(id, 'waiting')],
    ['once its Claude quit', 'cannot-move', async (m, id) => {
      process.kill(childrenOf(await panePid(id))[0], 'SIGKILL');
      expect(await until(async () => (await m.listSessions()).find((s) => s.id === id)?.status === 'ended')).toBe(true);
    }],
  ])('refuses %s, and leaves it as it was', async (_name, code, make) => {
    const { m } = machine();
    const { id } = await onDefault(m);
    await m.pickClaudeAccount(B);
    await make(m, id);
    await expect(m.moveThis(id)).rejects.toMatchObject({ status: 409, code });
    expect(startsOn(id)).toHaveLength(1);
  });

  it('refuses before any account was picked', async () => {
    const { m } = machine();
    const s = await m.createSession({ kind: 'claude', cwd: dir });
    await started(s.id);
    m.setStatus(s.id, 'idle');
    await expect(m.moveThis(s.id)).rejects.toMatchObject({ status: 409, code: 'account-none-picked' });
  });

  it('refuses, saying why, when its Claude will not quit', async () => {
    const { m } = machine(STUBBORN);
    const { id } = await onDefault(m);
    await m.pickClaudeAccount(B);
    await expect(m.moveThis(id)).rejects.toMatchObject({ status: 409, code: 'move-failed' });
    expect(startsOn(id)).toHaveLength(1);
  }, 15_000);

  it('quits a Claude at its prompt in a terminal on the Mac that holds the conversation too, before moving', async () => {
    const { m } = listingMachine();
    const { id, sid } = await onDefault(m);
    const there = await openOnMac(sid, 'idle');
    await m.pickClaudeAccount(B);
    await m.moveThis(id);
    expect(await until(() => !alive(there))).toBe(true);
    await started(id, 2);
    expect(startsOn(id)).toEqual(['-unset-', B]);
  });

  it.each(['busy', 'waiting'])('refuses while a Claude on the Mac holding the conversation is %s, quitting nothing', async (status) => {
    const { m } = listingMachine();
    const { id, sid } = await onDefault(m);
    const there = await openOnMac(sid, status);
    await m.pickClaudeAccount(B);
    await expect(m.moveThis(id)).rejects.toMatchObject({ status: 409, code: 'open-on-mac-busy' });
    expect(alive(there)).toBe(true);
    expect(startsOn(id)).toHaveLength(1);
  });
});

describe("LocalMachine, quitting the Claudes in terminals on the Mac that hold a session's conversation too", () => {
  const listingMachine = () => make({ claudeArgs: RUNS, claudeAccounts: accounts(), claudeBin: listing });
  const shownOnMac = (m: LocalMachine, id: string) => m.journal.sync(id, undefined, 0).rows.find((r) => r.t === 'state' && r.key === 'onMac')?.body;

  it('quits one at its prompt, leaving the session as it was and no longer showing it open there', async () => {
    const { m } = listingMachine();
    const { id, sid } = await onDefault(m);
    const there = await openOnMac(sid, 'idle');
    await m.openOnMac();
    expect(shownOnMac(m, id)).toBe(1);
    await m.quitOnMac(id);
    expect(alive(there)).toBe(false);
    expect(shownOnMac(m, id)).toBe(0);
    await new Promise((r) => setTimeout(r, 300));
    expect(startsOn(id)).toHaveLength(1);
  });

  it.each(['busy', 'waiting'])('refuses while one there is %s, quitting nothing', async (status) => {
    const { m } = listingMachine();
    const { id, sid } = await onDefault(m);
    const there = await openOnMac(sid, status);
    await expect(m.quitOnMac(id)).rejects.toMatchObject({ status: 409, code: 'open-on-mac-busy' });
    expect(alive(there)).toBe(true);
  });

  it('does nothing when none holds it', async () => {
    const { m } = listingMachine();
    const { id } = await onDefault(m);
    await m.quitOnMac(id);
    expect(startsOn(id)).toHaveLength(1);
  });

  it('refuses a session that is not there', async () => {
    const { m } = listingMachine();
    await expect(m.quitOnMac('nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('LocalMachine, moving the one session asked for now, or once it is free', () => {
  const listingMachine = (claudeArgs = RUNS) => make({ claudeArgs, claudeAccounts: accounts(), claudeBin: listing });
  const nowAt = (p: ChildProcess, sid: string, status: string) =>
    writeFileSync(LIST, JSON.stringify([{ pid: p.pid, sessionId: sid, cwd: dir, kind: 'interactive', status }]));

  it.each<[string, (m: LocalMachine, id: string) => void]>([
    ['works', (m, id) => m.setStatus(id, 'working')],
    ['asks something', (m, id) => m.setStatus(id, 'waiting')],
  ])('moves one that %s now when asked to, interrupting it', async (_name, busy) => {
    const { m, store } = machine();
    const { id } = await onDefault(m);
    await m.pickClaudeAccount(B);
    busy(m, id);
    await m.moveThis(id, 'now');
    await started(id, 2);
    expect(store.get().sessions[id].claudeDir).toBe(B);
  });

  it('quits the Claudes on the Mac holding the conversation now when asked to, whatever they are doing', async () => {
    const { m } = listingMachine();
    const { id, sid } = await onDefault(m);
    const there = await openOnMac(sid, 'busy');
    await m.pickClaudeAccount(B);
    await m.moveThis(id, 'now');
    expect(alive(there)).toBe(false);
    await started(id, 2);
  });

  it('moves one at work once its turn is over, when asked to wait for that', async () => {
    const { m, store } = machine();
    const { id } = await onDefault(m);
    await m.pickClaudeAccount(B);
    m.setStatus(id, 'working');
    expect((await m.moveThis(id, 'free')).id).toBe(id);
    expect(store.get().sessions[id].moving).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(startsOn(id)).toHaveLength(1);
    m.setStatus(id, 'idle');
    expect(await moved(id)).toBe(true);
    expect(store.get().sessions[id].claudeDir).toBe(B);
    expect(await until(() => !store.get().sessions[id].moving)).toBe(true);
  });

  it('moves one started from a terminal once its turn is over, when asked to wait for that', async () => {
    const { m, store } = machine();
    const { id } = await onDefault(m, { env: { TERM_PROGRAM: 'Apple_Terminal', CLAUDE_CONFIG_DIR: join(home, '.claude') } });
    await m.pickClaudeAccount(B);
    m.setStatus(id, 'working');
    await m.moveThis(id, 'free');
    m.setStatus(id, 'idle');
    expect(await moved(id)).toBe(true);
    expect(store.get().sessions[id].claudeDir).toBe(B);
  });

  it('waits for a Claude on the Mac holding the conversation to stop, then quits it and moves', async () => {
    const { m } = listingMachine();
    const { id, sid } = await onDefault(m);
    const there = await openOnMac(sid, 'busy');
    await m.pickClaudeAccount(B);
    await m.moveThis(id, 'free');
    await new Promise((r) => setTimeout(r, 1000));
    expect(alive(there)).toBe(true);
    expect(startsOn(id)).toHaveLength(1);
    nowAt(there, sid, 'idle');
    expect(await until(() => !alive(there), 10_000)).toBe(true);
    expect(await moved(id)).toBe(true);
  }, 20_000);

  it('quits an idle Claude on the Mac holding the conversation before moving the open sessions too', async () => {
    const { m } = listingMachine();
    const { id, sid } = await onDefault(m);
    const there = await openOnMac(sid, 'idle');
    await m.pickClaudeAccount(B);
    await m.moveToAccountInUse();
    expect(await until(() => !alive(there))).toBe(true);
    expect(await moved(id)).toBe(true);
  });

  it('quits a Claude on the Mac that is at work when told to, and not otherwise', async () => {
    const { m } = listingMachine();
    const { id, sid } = await onDefault(m);
    const there = await openOnMac(sid, 'busy');
    await expect(m.quitOnMac(id)).rejects.toMatchObject({ code: 'open-on-mac-busy' });
    await m.quitOnMac(id, true);
    expect(alive(there)).toBe(false);
  });
});
