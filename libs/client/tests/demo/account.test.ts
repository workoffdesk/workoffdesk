import { describe, expect, it } from 'vitest';
import { accountsOnStart, addressesOf, DEMO_LOGIN, foldAccounts, isDemo, learnedAddresses } from '../../src/demo/account';

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

describe('the addresses of an account', () => {
  const MAIN = 'https://workoffdesk.example.com';
  const OTHER = 'https://other.example.com';

  it('are the one signed in to until the Mac names more', () => {
    expect(addressesOf(mac)).toEqual([MAIN]);
    expect(addressesOf({ ...mac, addresses: [MAIN, OTHER] })).toEqual([MAIN, OTHER]);
  });

  it.each([
    ['names them, the origin first', { addresses: [MAIN, OTHER] }, [MAIN, OTHER]],
    ['names the one signed in to after another', { addresses: [OTHER, MAIN] }, [MAIN, OTHER]],
    ['leaves out the one signed in to', { addresses: [OTHER] }, [MAIN, OTHER]],
    ['names one twice', { addresses: [OTHER, OTHER] }, [MAIN, OTHER]],
    ['names a plain http address', { addresses: ['http://other.example.com'] }, [MAIN]],
    ['names something that is not an address', { addresses: ['other.example.com', 7, null, 'https://other.example.com/path'] }, [MAIN]],
    ['says nothing that can be read', null, [MAIN]],
    ['answers with no list', { addresses: 'https://other.example.com' }, [MAIN]],
  ])('start with the one signed in to when the Mac %s', (_, said, want) => {
    expect(learnedAddresses(mac, said)).toEqual(want);
  });

  it('keep an address signed in to that the Mac does not name, such as this phone', () => {
    const local = { server: 'http://localhost:7681', token: 't', user: 'me' };
    expect(learnedAddresses(local, { addresses: [MAIN] })).toEqual(['http://localhost:7681', MAIN]);
  });
});

describe('foldAccounts', () => {
  const MAIN = 'https://workoffdesk.example.com';
  const OTHER = 'https://other.example.com';
  const here = { server: MAIN, token: 't1', user: 'me', addresses: [MAIN, OTHER] };
  const there = { server: OTHER, token: 't2', user: 'me' };

  it('folds a kept account of the same user at another address of the Mac into the one given', () => {
    expect(foldAccounts([{ server: MAIN, token: 't1', user: 'me' }, there], here)).toEqual({ kept: [here], gone: [there] });
  });

  it.each([
    ['another user on the same Mac', { server: OTHER, token: 't3', user: 'you' }],
    ['the same user on another Mac', { server: 'https://elsewhere.example.com', token: 't4', user: 'me' }],
  ])('keeps %s', (_, other) => {
    expect(foldAccounts([here, other], here)).toEqual({ kept: [here, other], gone: [] });
  });

  it('keeps the order the accounts were added in', () => {
    const elsewhere = { server: 'https://elsewhere.example.com', token: 't4', user: 'me' };
    expect(foldAccounts([elsewhere, there, { ...here, addresses: undefined }], here).kept).toEqual([elsewhere, here]);
  });
});
