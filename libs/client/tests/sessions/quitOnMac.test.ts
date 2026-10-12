import { t } from '@workoffdesk/i18n';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../../src/base/api';
import { quitOnMac } from '../../src/sessions/quitOnMac';

// A Mac whose copy of the conversation is at work until told to quit it anyway; each call to it, with what it was sent.
const mac = (refuse?: string) => {
  const calls: [string, unknown][] = [];
  const api = vi.fn(async (path: string, init?: { method?: string; json?: unknown }) => {
    calls.push([`${init?.method ?? 'GET'} ${path}`, init?.json]);
    const force = (init?.json as { force?: boolean } | undefined)?.force;
    if (refuse && !(refuse === 'open-on-mac-busy' && force)) throw new ApiError(409, 'said by the Mac', undefined, refuse);
    return undefined;
  }) as unknown as Api;
  return { api, calls };
};

describe('quitOnMac', () => {
  it('quits the Claudes on the Mac without asking when none there is at work', async () => {
    const { api, calls } = mac();
    const confirm = vi.fn(async () => true);
    expect(await quitOnMac(api, 's1', confirm)).toBeNull();
    expect(calls).toEqual([['POST /api/m/local/sessions/s1/quit-on-mac', undefined]]);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks first when one there is at work, and quits it when told to', async () => {
    const { api, calls } = mac('open-on-mac-busy');
    expect(await quitOnMac(api, 's1', async () => true)).toBeNull();
    expect(calls.map(([, json]) => json)).toEqual([undefined, { force: true }]);
  });

  it('quits nothing when told not to', async () => {
    const { api, calls } = mac('open-on-mac-busy');
    expect(await quitOnMac(api, 's1', async () => false)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('says why when it could not', async () => {
    const { api } = mac('mac-would-not-quit');
    expect(await quitOnMac(api, 's1', async () => true)).toBe(t.serverErrors['mac-would-not-quit']);
  });
});
