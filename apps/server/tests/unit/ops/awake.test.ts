import { execFileSync, spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { keepAwake } from '../../../src/ops/awake.js';

const fakeSpawn = () => {
  const calls: unknown[][] = [];
  const f = ((...a: unknown[]) => {
    calls.push(a);
    return { on() { return this; }, unref() {} };
  }) as unknown as typeof spawn;
  return { f, calls };
};

describe('keepAwake', () => {
  it('holds off idle sleep for as long as the server process lives', () => {
    const s = fakeSpawn();
    keepAwake({ enabled: true, platform: 'darwin', pid: 4242, spawn: s.f, log: () => {} });
    expect(s.calls).toEqual([['caffeinate', ['-i', '-w', '4242'], { stdio: 'ignore' }]]);
  });

  it.each([
    [false, 'darwin'],
    [true, 'linux'],
  ])('does nothing when enabled is %s on %s', (enabled, platform) => {
    const s = fakeSpawn();
    expect(keepAwake({ enabled, platform: platform as NodeJS.Platform, pid: 1, spawn: s.f, log: () => {} })).toBeUndefined();
    expect(s.calls).toEqual([]);
  });

  it('logs, and does not throw, when caffeinate cannot start', async () => {
    const logged: string[] = [];
    const failing = ((..._: unknown[]) => spawn('/nonexistent/caffeinate', [])) as unknown as typeof spawn;
    expect(() => keepAwake({ enabled: true, platform: 'darwin', pid: 1, spawn: failing, log: (msg) => logged.push(msg) })).not.toThrow();
    await new Promise((r) => setTimeout(r, 200));
    expect(logged.length).toBe(1);
  });

  // The real caffeinate: its assertion holds while the process it watches lives, and goes with it.
  it.runIf(process.platform === 'darwin')('lets the Mac sleep again once the process it watches ends', async () => {
    const assertions = () => execFileSync('pmset', ['-g', 'assertions'], { encoding: 'utf8' });
    const watched = spawn('sleep', ['30'], { stdio: 'ignore' });
    const awake = keepAwake({ enabled: true, platform: 'darwin', pid: watched.pid!, spawn, log: () => {} })!;
    const mine = new RegExp(`pid ${awake.pid}\\(caffeinate\\).*PreventUserIdleSystemSleep`);
    const until = async (cond: () => boolean) => {
      for (let i = 0; i < 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 100));
      return cond();
    };
    expect(await until(() => mine.test(assertions()))).toBe(true);
    watched.kill();
    expect(await until(() => !mine.test(assertions()))).toBe(true);
  });
});
