import { t } from '@workoffdesk/i18n';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type ClaudeStatus } from '../../src/base/api';
import { emptyView, type JournalItem, type SessionView } from '../../src/journal/journalRows';
import type { ClaudeAccount, ClaudeAccounts } from '../../src/mac/macPage';
import type { ChatItem, OnScreen } from '../../src/model/chat';
import { accountsToMoveTo, createAccountMove, limitStopped, moveOptionLine } from '../../src/sessions/moveAccount';

const account = (id: string, email: string, o: Partial<ClaudeAccount> = {}): ClaudeAccount => ({
  id,
  folder: id ? id.replace('/Users/me', '~') : '~/.claude',
  email,
  signedIn: true,
  ready: true,
  shared: true,
  limits: null,
  ...o,
});
const OWN = account('', 'own@example.com');
const WORK = account('/Users/me/.claude-work', 'work@example.com');
const view = (accounts: ClaudeAccount[], inUse = ''): ClaudeAccounts => ({ accounts, inUse, picked: false, elsewhere: 0, moving: 0 });
const ids = (as: ClaudeAccount[]) => as.map((a) => a.id);

describe('accountsToMoveTo', () => {
  it('offers the accounts other than the one the session runs on', () => {
    expect(ids(accountsToMoveTo(view([OWN, WORK]), 'own@example.com'))).toEqual([WORK.id]);
    expect(ids(accountsToMoveTo(view([OWN, WORK]), 'work@example.com'))).toEqual([OWN.id]);
  });

  it('leaves out another folder of the same account, whose limit is the same', () => {
    const again = account('/Users/me/.claude-again', 'own@example.com');
    expect(ids(accountsToMoveTo(view([OWN, again, WORK]), 'own@example.com'))).toEqual([WORK.id]);
  });

  it('takes a session whose account is not known as running on the one in use', () => {
    expect(ids(accountsToMoveTo(view([OWN, WORK], WORK.id), undefined))).toEqual([OWN.id]);
  });

  it.each<[string, Partial<ClaudeAccount>]>([
    ['signed out', { signedIn: false }],
    ['not set up', { ready: false }],
    ['keeping its conversations apart', { shared: false }],
  ])('leaves out one %s, which cannot be picked', (_, o) => {
    expect(accountsToMoveTo(view([OWN, account(WORK.id, WORK.email, o)]), 'own@example.com')).toEqual([]);
  });

  it('offers none on a Mac with one account', () => {
    expect(accountsToMoveTo(view([OWN]), undefined)).toEqual([]);
  });
});

describe('moveOptionLine', () => {
  it('says the folder alone of an account whose usage was never seen', () => {
    expect(moveOptionLine(WORK)).toBe('~/.claude-work');
  });

  it('says the folder and the usage last seen', () => {
    const seen = { ...WORK, limits: { fiveHour: { used: 40 }, at: Date.now() } };
    expect(moveOptionLine(seen)).toMatch(/^~\/\.claude-work · .+/);
  });
});

const items = (...list: ChatItem[]): JournalItem[] => list.map((i, pos) => ({ ...i, itemId: `i${pos}`, pos, conv: 'c' }));
const asked: ChatItem = { k: 'user', text: 'go', at: '2026-10-09T10:00:00Z' };
const hit: ChatItem = { k: 'note', event: { e: 'failed', limit: true }, detail: "You've hit your weekly limit" };
const stopped = (over: { items?: ChatItem[]; status?: ClaudeStatus; queued?: number; screen?: Partial<OnScreen> } = {}) => {
  const view: SessionView = { ...emptyView, synced: true, items: items(...(over.items ?? [asked, hit])), screen: { choices: null, panel: null, ...over.screen } };
  return limitStopped({ view, status: over.status ?? 'idle', queued: over.queued ?? 0 });
};

describe('limitStopped', () => {
  it('is the chat stopped, last, on a limit', () => {
    expect(stopped()).toBe(true);
  });

  it.each<[string, Parameters<typeof stopped>[0]]>([
    ['a limit gone on from', { items: [asked, hit, asked] }],
    ['another failure', { items: [asked, { k: 'note', event: { e: 'failed' }, detail: 'x' }] }],
    ['a chat with nothing in it', { items: [] }],
    ['while Claude works again', { status: 'working' }],
    ['while a message waits to go', { queued: 1 }],
    ['while a panel is open', { screen: { panel: { title: 'Model', body: '', hint: '' } } }],
  ])('is not %s', (_, over) => {
    expect(stopped(over)).toBe(false);
  });
});

// A Mac with two accounts whose sessions run on the default; what each call to it was. refuse: what the Mac
// says when the session s1 is asked to move; failOthers: the move of the other sessions fails.
type Mac = { refuse?: string; failOthers?: boolean };
const mac = (o: Mac = {}) => {
  const calls: [string, unknown][] = [];
  const api = vi.fn(async (path: string, init?: { method?: string; json?: unknown }) => {
    calls.push([`${init?.method ?? 'GET'} ${path}`, init?.json]);
    if (path === '/api/m/local/sessions/s1/move' && o.refuse) throw new ApiError(409, o.refuse, undefined, 'open-on-mac-busy');
    if (path === '/api/claude/account/move' && o.failOthers) throw new Error('down');
    return view([OWN, WORK]);
  }) as unknown as Api;
  const sent: string[] = [];
  const m = createAccountMove(api, 's1', (text) => void sent.push(text));
  return { m, calls, sent };
};
const loaded = async (o: Mac = {}) => {
  const r = mac(o);
  await r.m.load('own@example.com');
  return r;
};

describe('createAccountMove', () => {
  it('has the accounts the session can go on on', async () => {
    const { m } = await loaded();
    expect(ids(m.getSnapshot().accounts!)).toEqual([WORK.id]);
  });

  it('picks the account, moves this session to it and then the rest, and says what was asked for once this one runs there', async () => {
    const { m, calls, sent } = await loaded();
    m.offer('谢谢', true);
    await m.move(WORK.id);
    expect(calls.slice(1)).toEqual([
      ['PUT /api/claude/account', { id: WORK.id }],
      ['POST /api/m/local/sessions/s1/move', undefined],
      ['POST /api/claude/account/move', undefined],
    ]);
    expect(m.getSnapshot()).toMatchObject({ asking: null, moving: null, waiting: { email: 'work@example.com', text: '谢谢' } });
    m.seen('own@example.com');
    expect(sent).toEqual([]);
    m.seen('work@example.com');
    m.seen('work@example.com');
    expect(sent).toEqual(['谢谢']);
    expect(m.getSnapshot().waiting).toBeNull();
  });

  it('shows why, says nothing, keeps the offer open and moves no other session when this one is not moved', async () => {
    const { m, calls, sent } = await loaded({ refuse: 'said by the Mac' });
    m.offer('继续', false);
    await m.move(WORK.id);
    expect(m.getSnapshot()).toMatchObject({ asking: { text: '继续', typed: false }, moving: null, waiting: null, error: t.serverErrors['open-on-mac-busy'] });
    expect(calls.map(([c]) => c)).not.toContain('POST /api/claude/account/move');
    m.seen('work@example.com');
    expect(sent).toEqual([]);
  });

  it('goes on as moved when only the move of the other sessions fails', async () => {
    const { m, sent } = await loaded({ failOthers: true });
    m.offer('继续', false);
    await m.move(WORK.id);
    expect(m.getSnapshot()).toMatchObject({ asking: null, error: null, waiting: { email: 'work@example.com', text: '继续' } });
    m.seen('work@example.com');
    expect(sent).toEqual(['继续']);
  });

  it.each([
    ['nothing was asked for', null],
    ['the account is not one to move to', 'own'],
  ])('moves nothing when %s', async (_, to) => {
    const { m, calls } = await loaded();
    if (to) m.offer('继续', false);
    await m.move(to ? OWN.id : WORK.id);
    expect(calls).toHaveLength(1);
  });

  it('takes one move at a time', async () => {
    const { m, calls } = await loaded();
    m.offer('继续', false);
    const first = m.move(WORK.id);
    void m.move(WORK.id);
    await first;
    expect(calls.filter(([c]) => c === 'PUT /api/claude/account')).toHaveLength(1);
  });

  it('gives back what was typed when not moved, and nothing when it was not typed', async () => {
    const { m } = await loaded();
    m.offer('谢谢', true);
    expect(m.dismiss()).toBe('谢谢');
    m.offer('继续', false);
    expect(m.dismiss()).toBeNull();
    expect(m.getSnapshot().asking).toBeNull();
  });

  it('tells its listeners of each change', async () => {
    const { m } = await loaded();
    const heard = vi.fn();
    const stop = m.subscribe(heard);
    m.offer('继续', false);
    m.dismiss();
    stop();
    m.offer('继续', false);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
