import { t } from '@workoffdesk/i18n';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../../src/base/api';
import { pinAction } from '../../src/sessions/pin';

const mac = (fail?: Error) => {
  const calls: string[] = [];
  const api = vi.fn(async (path: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (fail) throw fail;
  }) as unknown as Api;
  return { api, calls };
};

describe('pinAction', () => {
  it.each([
    ['pins one that is not', {}, t.pin, 'PUT'],
    ['unpins one that is', { pinned: 1000 }, t.unpin, 'DELETE'],
  ])('%s', async (_, state, label, method) => {
    const { api, calls } = mac();
    const action = pinAction(api, { id: 's1', ...state });
    expect(action.label).toBe(label);
    expect(await action.run()).toBeNull();
    expect(calls).toEqual([`${method} /api/m/local/sessions/s1/pin`]);
  });

  it('says why when the Mac would not', async () => {
    expect(await pinAction(mac(new ApiError(404, 'no such session')).api, { id: 's1' }).run()).toBe(t.goneOnMac);
    expect(await pinAction(mac(new Error('boom')).api, { id: 's1' }).run()).toBe(t.pinFailed);
  });
});
