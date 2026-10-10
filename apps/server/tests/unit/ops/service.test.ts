import { describe, expect, it } from 'vitest';
import { isManaged, startService, stopService, type ServiceDeps } from '../../../src/ops/service.js';

const TARGET = 'gui/501/local.workoffdesk';

// launchd as `launchctl` shows it: loaded or not.
const launchd = (loaded: boolean) => {
  const calls: string[][] = [];
  const d: ServiceDeps = {
    uid: 501,
    label: 'local.workoffdesk',
    exec: async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (args[0] === 'print') return loaded ? { code: 0, out: 'state = running\n\tpid = 42\n' } : { code: 113, out: 'Could not find service' };
      return { code: 0, out: '' };
    },
  };
  return { d, calls: () => calls.filter((c) => c[1] !== 'print') };
};

describe('startService', () => {
  it('loads its agent when launchd does not have it', async () => {
    const { d, calls } = launchd(false);
    await startService(d, '/Users/me/Library/LaunchAgents/local.workoffdesk.plist');
    expect(calls()).toEqual([['launchctl', 'bootstrap', 'gui/501', '/Users/me/Library/LaunchAgents/local.workoffdesk.plist']]);
  });

  it('starts the loaded one without killing it', async () => {
    const { d, calls } = launchd(true);
    await startService(d, '/x.plist');
    expect(calls()).toEqual([['launchctl', 'kickstart', TARGET]]);
  });

  it('says what launchctl said when it fails', async () => {
    const d: ServiceDeps = { uid: 501, label: 'local.workoffdesk', exec: async (_c, a) => (a[0] === 'print' ? { code: 113, out: '' } : { code: 5, out: 'Input/output error' }) };
    await expect(startService(d, '/x.plist')).rejects.toThrow('Input/output error');
  });
});

describe('stopService', () => {
  it('unloads it, so KeepAlive does not bring it back', async () => {
    const { d, calls } = launchd(true);
    await stopService(d);
    expect(calls()).toEqual([['launchctl', 'bootout', TARGET]]);
  });

  it('does nothing when it is not loaded', async () => {
    const { d, calls } = launchd(false);
    await stopService(d);
    expect(calls()).toEqual([]);
  });
});

describe('isManaged', () => {
  it.each([
    [{ XPC_SERVICE_NAME: 'local.workoffdesk' }, true],
    [{ XPC_SERVICE_NAME: 'com.apple.Terminal' }, false],
    [{}, false],
  ])('%j → %s', (env, managed) => {
    expect(isManaged(env, 'local.workoffdesk')).toBe(managed);
  });
});
