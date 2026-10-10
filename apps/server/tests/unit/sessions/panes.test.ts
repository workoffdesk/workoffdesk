import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { agentsRunning, shellBusy } from '../../../src/sessions/panes.js';

// Processes of the test's own, each in a group of its own, stopped with it.
const started: ChildProcess[] = [];
const start = (bin: string, args: string[]) => {
  const p = spawn(bin, args, { stdio: 'ignore', detached: true });
  started.push(p);
  return p.pid!;
};
afterAll(() => {
  for (const p of started) if (p.exitCode === null) process.kill(-p.pid!, 'SIGKILL');
});
// A shell with a program running under it, once it is.
const withProgram = async () => {
  const p = spawn('/bin/sh', ['-c', 'sleep 30 & echo started; wait'], { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
  started.push(p);
  await new Promise((r) => p.stdout!.once('data', r));
  return p.pid!;
};
const gone = async () => {
  const p = spawn('/usr/bin/true');
  await new Promise((r) => p.on('exit', r));
  return p.pid!;
};

describe('agentsRunning', () => {
  it('tells it runs while the pane is still the wrapper it was started with, and not once that is the login shell or gone', async () => {
    const wrapper = start('/bin/sh', ['-lc', 'sleep 30; exit']);
    const shell = start('/bin/sleep', ['30']);
    const ended = await gone();
    expect(await agentsRunning([wrapper, shell, ended])).toEqual(
      new Map([
        [wrapper, true],
        [shell, false],
        [ended, false],
      ]),
    );
  });

  it('finds it in none of the panes when every one is gone', async () => {
    const [a, b] = [await gone(), await gone()];
    expect(await agentsRunning([a, b])).toEqual(new Map([[a, false], [b, false]]));
  });

  it('asks no process when there are no panes', async () => {
    expect(await agentsRunning([])).toEqual(new Map());
  });
});

describe('shellBusy', () => {
  it('tells it busy while a program started there runs, and not when nothing does', async () => {
    expect(await shellBusy(await withProgram())).toBe(true);
    expect(await shellBusy(start('/bin/sleep', ['30']))).toBe(false);
    expect(await shellBusy(await gone())).toBe(false);
  });

  it('does not guess when it cannot be looked at', async () => {
    await expect(shellBusy(Number.NaN)).rejects.toThrow('could not look at what runs under process NaN');
  });
});
