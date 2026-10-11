import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { LocalMachine } from '../../../src/sessions/machine.js';
import { RUNS, machineSetup } from '../../helpers/machine.js';
import { until } from '../../helpers/until.js';

// A name given a session here becomes its conversation's name in Claude: typed as /rename to a Claude that
// runs, given as --name to one started; and nothing Claude still holds from before takes it back.
const { dir, tmux, argsFile, make, restarted } = machineSetup('mn');
afterAll(() => tmux.killServer());

const RULE = '─'.repeat(20);
// A Claude that writes down each line typed to it, with `shown` on screen first, its prompt holding `draft`
// until the file `go` is made.
const claudeTyping = (draft?: string) => {
  const at = mkdtempSync(join(dir, 'c-'));
  const typed = join(at, 'typed');
  const go = join(at, 'go');
  writeFileSync(typed, '');
  const prompt = (text: string) => `printf '%s\\n' '${RULE}' '❯\u00a0${text}'`;
  const run = draft === undefined
    ? `exec cat >> ${typed}`
    : `${prompt(draft)}; (while [ ! -f ${go} ]; do sleep 0.1; done; printf '\\033[2J\\033[H'; ${prompt('')}) & exec cat >> ${typed}`;
  return { claudeArgs: ['--run', run], lines: () => readFileSync(typed, 'utf8').split('\n').filter(Boolean), free: () => writeFileSync(go, '') };
};
const startedWith = () => readFileSync(argsFile, 'utf8').split('\n');

describe('a name given a Claude session here', () => {
  it('is typed to its Claude as /rename, once', async () => {
    const c = claudeTyping();
    const { m } = make({ claudeArgs: c.claudeArgs });
    const s = await m.createSession({ kind: 'claude', cwd: dir });
    await m.renameSession(s.id, 'Fix the login');
    expect(await until(() => c.lines().length > 0, 8_000)).toBe(true);
    // Checked again a few times meanwhile, it is not typed again while Claude has not said it took it.
    await new Promise((r) => setTimeout(r, 5_000));
    expect(c.lines()).toEqual(['/rename Fix the login']);
  }, 20_000);

  it('waits while something is typed at the prompt, then is typed', async () => {
    const c = claudeTyping('half a thought');
    const { m } = make({ claudeArgs: c.claudeArgs });
    const s = await m.createSession({ kind: 'claude', cwd: dir });
    await until(async () => (await tmux.screen(`wod-${s.id}`)).includes('half a thought'));
    await m.renameSession(s.id, 'Fix the login');
    await new Promise((r) => setTimeout(r, 4_000));
    expect(c.lines()).toEqual([]);
    c.free();
    expect(await until(() => c.lines().length > 0, 8_000)).toBe(true);
    expect(c.lines()).toEqual(['/rename Fix the login']);
  }, 20_000);

  it('is still on its way after a restart, and typed then', async () => {
    const c = claudeTyping('half a thought');
    const { m, store } = make({ claudeArgs: c.claudeArgs });
    const s = await m.createSession({ kind: 'claude', cwd: dir });
    await until(async () => (await tmux.screen(`wod-${s.id}`)).includes('half a thought'));
    await m.renameSession(s.id, 'Fix the login');
    m.closeJournal();
    restarted(store);
    c.free();
    expect(await until(() => c.lines().length > 0, 8_000)).toBe(true);
    expect(c.lines()).toEqual(['/rename Fix the login']);
  }, 20_000);

  it('starts a new Claude with --name', async () => {
    const { m } = make({ claudeArgs: RUNS });
    await m.createSession({ kind: 'claude', cwd: dir, title: 'Fix the login' });
    expect(await until(() => existsSync(argsFile) && startedWith().includes('--name'))).toBe(true);
    const args = startedWith();
    expect(args[args.indexOf('--name') + 1]).toBe('Fix the login');
  });

  it('starts a Claude given no name without --name', async () => {
    writeFileSync(argsFile, '');
    const { m } = make({ claudeArgs: RUNS });
    await m.createSession({ kind: 'claude', cwd: dir });
    expect(await until(() => startedWith().some((a) => a.startsWith('env=')))).toBe(true);
    expect(startedWith()).not.toContain('--name');
  });

  it('is not empty', async () => {
    const { m } = make({ claudeArgs: RUNS });
    const s = await m.createSession({ kind: 'claude', cwd: dir, title: 'Fix the login' });
    await expect(m.renameSession(s.id, '   ')).rejects.toThrow();
    expect((await m.listSessions()).find((x) => x.id === s.id)?.title).toBe('Fix the login');
  });
});

describe('the name Claude writes into its transcript', () => {
  const setup = async () => {
    const projects = mkdtempSync(join(dir, 'p-'));
    const { m, store } = make({ claudeArgs: RUNS, claudeProjectsRoot: projects });
    const s = await m.createSession({ kind: 'claude', cwd: dir });
    mkdirSync(join(projects, 'here'));
    const file = join(projects, 'here', `${s.claudeSessionId}.jsonl`);
    writeFileSync(file, `${JSON.stringify({ type: 'user', cwd: dir, message: { content: 'hello' } })}\n`);
    const writes = async (name: string) => {
      appendFileSync(file, `${JSON.stringify({ type: 'custom-title', customTitle: name, sessionId: s.claudeSessionId })}\n`);
      await m.ingest(s.id);
    };
    const title = async () => (await m.listSessions()).find((x) => x.id === s.id)?.title;
    return { m, store, s, writes, title };
  };

  it('does not take back the name given here with the one it held before', async () => {
    const { m, s, writes, title } = await setup();
    await writes('Old name');
    expect(await title()).toBe('Old name');
    await m.renameSession(s.id, 'New name');
    await writes('Old name');
    expect(await title()).toBe('New name');
  });

  it('is the name given here once Claude took it, and a name given at the Mac after that shows', async () => {
    const { m, store, s, writes, title } = await setup();
    await m.renameSession(s.id, 'New name');
    expect(store.get().sessions[s.id].naming).toBe('New name');
    await writes('New name');
    expect(store.get().sessions[s.id].naming).toBeUndefined();
    expect(await title()).toBe('New name');
    await writes('Named at the Mac');
    expect(await title()).toBe('Named at the Mac');
  });

  // A save sent again over a bad line arrives after Claude took the name the first one gave.
  it('is not given again when a session is given the name it has', async () => {
    const { m, store, s, writes } = await setup();
    await m.renameSession(s.id, 'New name');
    await writes('New name');
    expect(store.get().sessions[s.id].naming, 'precondition: Claude took the name').toBeUndefined();
    expect(await m.renameSession(s.id, '  New name ')).toMatchObject({ id: s.id, title: 'New name' });
    expect(store.get().sessions[s.id].naming).toBeUndefined();
  });

  it.each([
    ['a name given at the Mac took its place', (m: LocalMachine, id: string, writes: (n: string) => Promise<void>) => writes('Named at the Mac')],
    ['another name given here is on its way', (m: LocalMachine, id: string) => m.renameSession(id, 'Other name')],
  ])('is given again once %s', async (_, between) => {
    const { m, store, s, writes } = await setup();
    await m.renameSession(s.id, 'New name');
    await writes('New name');
    await between(m, s.id, writes);
    await m.renameSession(s.id, 'New name');
    expect(store.get().sessions[s.id].naming).toBe('New name');
  });
});
