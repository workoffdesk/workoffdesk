import { describe, expect, it } from 'vitest';
import type { AccountsView } from '../../../src/agents/claude/accounts.js';
import { accountLines, findAccount } from '../../../src/commands/account.js';
import { en } from '../../../src/system/messages.js';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const account = (o: Partial<AccountsView['accounts'][number]> & { id: string; folder: string; email: string }) => ({
  signedIn: true,
  ready: true,
  shared: true,
  limits: null,
  ...o,
});
const view = (o: Partial<AccountsView> = {}): AccountsView => ({
  accounts: [
    account({ id: '', folder: '~/.claude', email: 'a@example.com', limits: { fiveHour: { used: 91.6, resetsAt: NOW / 1000 + 3600 }, sevenDay: { used: 40 }, at: NOW } }),
    account({ id: '/Users/someone/.claude-b', folder: '~/.claude-b', email: 'b@example.com' }),
    account({ id: '/Users/someone/.claude-c', folder: '~/.claude-c', email: 'c@example.com', signedIn: false }),
  ],
  inUse: '',
  picked: true,
  elsewhere: 0,
  moving: 0,
  ...o,
});

describe('findAccount', () => {
  it.each([
    ['its email', 'b@example.com'],
    ['its email, in any case', 'B@Example.com'],
    ['its folder', '~/.claude-b'],
    ['its folder in full', '/Users/someone/.claude-b'],
  ])('finds an account by %s', (_, who) => {
    expect(findAccount(view(), who, en.account)).toBe('/Users/someone/.claude-b');
  });

  it('finds the default account by its folder', () => {
    expect(findAccount(view(), '~/.claude', en.account)).toBe('');
  });

  it('refuses an email two accounts share, naming their folders', () => {
    const shared = view({ accounts: [...view().accounts, account({ id: '/Users/someone/.claude-d', folder: '~/.claude-d', email: 'b@example.com' })] });
    expect(() => findAccount(shared, 'b@example.com', en.account)).toThrow(en.account.twoWithEmail('b@example.com', ['~/.claude-b', '~/.claude-d']));
    expect(findAccount(shared, '~/.claude-d', en.account)).toBe('/Users/someone/.claude-d');
  });

  it('says when there is no such account', () => {
    expect(() => findAccount(view(), 'z@example.com', en.account)).toThrow(en.account.noSuch('z@example.com'));
  });
});

describe('accountLines', () => {
  it('lists each account with a check on the one in use, and what it used or why it cannot be picked', () => {
    expect(accountLines(view(), en.account, NOW)).toEqual([
      '✓ a@example.com  ~/.claude    5-hour 92% · 7-day 40%',
      '  b@example.com  ~/.claude-b  Not seen in use yet',
      '  c@example.com  ~/.claude-c  Signed out',
    ]);
  });

  it('says a limit past its reset is reset, not its old figure', () => {
    const v = view({ accounts: [account({ id: '', folder: '~/.claude', email: 'a@example.com', limits: { fiveHour: { used: 91.6, resetsAt: NOW / 1000 - 60 }, at: NOW } })] });
    expect(accountLines(v, en.account, NOW)).toEqual(['✓ a@example.com  ~/.claude  5-hour reset']);
  });

  it('then says how many open sessions are on another account, and how many will move', () => {
    expect(accountLines(view({ elsewhere: 2, moving: 1 }), en.account, NOW).slice(3)).toEqual(['', en.account.elsewhere(2), en.account.moving(1)]);
    expect(accountLines(view({ elsewhere: 0, moving: 3 }), en.account, NOW).slice(3)).toEqual(['', en.account.moving(3)]);
  });

  it.each([
    [1, '1 open session is on another account. To move it: workoffdesk account move', '1 session moves once its reply is done.'],
    [2, '2 open sessions are on another account. To move them: workoffdesk account move', '2 sessions move once their reply is done.'],
  ])('says %i session in the right number', (n, elsewhere, moving) => {
    expect([en.account.elsewhere(n), en.account.moving(n)]).toEqual([elsewhere, moving]);
  });
});
