import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { environmentOf, fromTerminal } from '../../../src/sessions/terminalEnv.js';

describe('fromTerminal', () => {
  it.each(['TERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'COLORTERM', 'TMUX', 'TMUX_PANE', 'SHLVL', 'PWD', 'OLDPWD', '_'])(
    'leaves out %s, which tmux sets anew for the session',
    (name) => {
      expect(fromTerminal({ [name]: 'from the terminal', PATH: '/usr/bin' })).toStrictEqual({ PATH: '/usr/bin' });
    },
  );

  it.each(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'WORKOFFDESK_SESSION'])('leaves out %s, which marks a program run inside another', (name) => {
    expect(fromTerminal({ [name]: '1', PATH: '/usr/bin' })).toStrictEqual({ PATH: '/usr/bin' });
  });

  it('keeps everything else as it was, so what was set up there goes on working', () => {
    const env = {
      PATH: '/work/venv/bin:/usr/bin',
      VIRTUAL_ENV: '/work/venv',
      AWS_PROFILE: 'staging',
      CLAUDE_CONFIG_DIR: '/work/.claude-other',
      NOTE: 'a value with spaces and = in it',
      EMPTY: '',
    };
    expect(fromTerminal(env)).toStrictEqual(env);
  });

  it.each([
    ["a shell's exported function", { 'BASH_FUNC_greet%%': '() {  echo hi\n}' }],
    ['a name tmux cannot set', { '1X': 'a', 'A-B': 'b', '': 'c' }],
    ['a variable with no value', { UNSET: undefined }],
  ])('leaves out %s', (_, env) => {
    expect(fromTerminal({ ...env, PATH: '/usr/bin' })).toStrictEqual({ PATH: '/usr/bin' });
  });
});

describe('environmentOf', () => {
  const started: ChildProcess[] = [];
  afterEach(() => {
    for (const p of started.splice(0)) p.kill('SIGKILL');
  });
  const run = async (bin: string, args: string[], env: Record<string, string>) => {
    const p = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'ignore'] });
    started.push(p);
    if (bin === process.execPath) await new Promise((r) => p.stdout!.once('data', r));
    return p;
  };
  const node = (env: Record<string, string>) => run(process.execPath, ['-e', "console.log('ready'); setInterval(() => {}, 1000)", 'an argument with spaces'], env);

  it('gives every variable it was given, values with spaces and = in them whole', async () => {
    const env = { PATH: '/usr/bin:/bin', SPACED: 'a b  c', EQUALS: 'x=y=z', EMPTY: '' };
    expect(await environmentOf((await node(env)).pid!)).toEqual(env);
  });

  it('cuts a value where it holds a space and what looks like another variable', async () => {
    expect(await environmentOf((await node({ HELD: 'left OTHER=right' })).pid!)).toEqual({ HELD: 'left', OTHER: 'right' });
  });

  it("gives nothing for one of the system's own programs, whose environment ps does not show", async () => {
    const p = await run('/bin/sleep', ['60'], { PATH: '/usr/bin:/bin', MARK: '1' });
    await new Promise((r) => setTimeout(r, 200));
    expect(await environmentOf(p.pid!)).toEqual({});
  });

  it('gives nothing for a process that is gone', async () => {
    const p = await node({ PATH: '/usr/bin' });
    const pid = p.pid!;
    p.kill('SIGKILL');
    await new Promise((r) => p.once('exit', r));
    expect(await environmentOf(pid)).toEqual({});
  });
});
