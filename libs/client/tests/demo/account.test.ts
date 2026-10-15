import { describe, expect, it } from 'vitest';
import { accountsOnStart, DEMO_LOGIN, isDemo } from '../../src/demo/account';

const mac = { server: 'https://workoffdesk.example.com', token: 't1', user: 'me' };

describe('the demo as an account', () => {
  it('is told apart from a Mac', () => {
    expect(isDemo(DEMO_LOGIN)).toBe(true);
    expect(isDemo(mac)).toBe(false);
    expect(isDemo(null)).toBe(false);
  });

  it('is in use again when the app opens, but not one of the accounts kept', () => {
    expect(accountsOnStart(DEMO_LOGIN, [])).toEqual([]);
    expect(accountsOnStart(DEMO_LOGIN, [mac])).toEqual([mac]);
  });

  it('leaves the accounts kept as they were for a Mac', () => {
    expect(accountsOnStart(mac, [])).toEqual([mac]);
    expect(accountsOnStart(mac, [mac])).toEqual([mac]);
    const again = { ...mac, token: 't2' };
    expect(accountsOnStart(again, [mac])).toEqual([again]);
    expect(accountsOnStart(null, [mac])).toEqual([mac]);
  });
});
