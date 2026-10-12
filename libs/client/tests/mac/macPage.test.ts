import { t } from '@workoffdesk/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../../src/base/api';
import { createMacPage, MAC_POLL_MS, MAC_WAIT_MS, MOVES_POLL_MS, type ClaudeAccounts, type MacReport } from '../../src/mac/macPage';
import { fakeApi } from '../helpers/fakes';

const report = (over: Partial<MacReport> = {}): MacReport => ({
  checks: [{ id: 'tmux', ok: true, detail: '3.5a' }],
  version: '3.0.0',
  build: { version: '3.0.0', commit: 'abc', dirty: false },
  release: 'b',
  releases: [],
  rollbackTo: 'a',
  managed: true,
  startedAt: 100,
  lastOp: null,
  ...over,
});
const GET = 'GET /api/mac?lang=en';
const PROBLEMS = 'GET /api/mac/problems';
const ACCOUNTS = 'GET /api/claude/accounts';
const PICK = 'PUT /api/claude/account';
const account = (id: string, email: string) => ({ id, folder: id || '~/.claude', email, signedIn: true, ready: true, shared: false, limits: null });
const MOVE = 'POST /api/claude/account/move';
const accounts = (inUse = '', o: { elsewhere?: number; moving?: number } = {}): ClaudeAccounts => ({
  accounts: [account('', 'someone@example.com'), account('~/.claude-work', 'work@example.com')],
  inUse,
  picked: inUse !== '',
  elsewhere: 0,
  moving: 0,
  ...o,
});

describe('createMacPage', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = async () => {
    const api = fakeApi();
    const page = createMacPage(api.api, 'en');
    const release = page.hold();
    await api.answer(GET, report());
    await api.answer(PROBLEMS, []);
    await api.answer(ACCOUNTS, accounts());
    return { api, page, release, snap: () => page.getSnapshot() };
  };

  it('loads the report, the problems and the Claude accounts held', async () => {
    const { snap } = await setup();
    expect(snap()).toMatchObject({ report: report(), problems: [], error: null, op: null, accounts: accounts(), picking: null });
  });

  it('shows what went wrong lately only with the report, so nothing comes in under the spinner', async () => {
    const api = fakeApi();
    const page = createMacPage(api.api, 'en');
    page.hold();
    const problem = { at: '2026-10-12T00:00:00.000Z', level: 'error' as const, msg: 'boom', detail: '{}', count: 1 };
    await api.answer(PROBLEMS, [problem]);
    expect(page.getSnapshot()).toMatchObject({ report: null, problems: null });
    await api.answer(GET, report());
    expect(page.getSnapshot()).toMatchObject({ report: report(), problems: [problem] });
  });

  it('shows what went wrong lately beside why the report could not be loaded', async () => {
    const api = fakeApi();
    const page = createMacPage(api.api, 'en');
    page.hold();
    await api.fail(GET, new NetworkError());
    expect(page.getSnapshot()).toMatchObject({ error: null, problems: null });
    await api.fail(PROBLEMS, new NetworkError());
    expect(page.getSnapshot()).toMatchObject({ error: t.noServer, problems: [] });
  });

  it('shows no accounts and no error from a server without a list of them', async () => {
    const api = fakeApi();
    const page = createMacPage(api.api, 'en');
    page.hold();
    await api.answer(GET, report());
    await api.answer(PROBLEMS, []);
    await api.fail(ACCOUNTS, new ApiError(404, 'not found'));
    expect(page.getSnapshot()).toMatchObject({ report: report(), error: null, accounts: null });
  });

  it('starts new sessions on the account tapped and lists the accounts as the server took the pick', async () => {
    const { api, page, snap } = await setup();
    page.pick('~/.claude-work');
    expect(snap().picking).toBe('~/.claude-work');
    expect(api.init(PICK)?.json).toEqual({ id: '~/.claude-work' });
    page.pick('');
    expect(api.waiting()).toEqual([PICK]);
    await api.answer(PICK, accounts('~/.claude-work'));
    expect(snap()).toMatchObject({ accounts: accounts('~/.claude-work'), picking: null, error: null });
  });

  it('says why an account could not be picked and keeps the list it had', async () => {
    const { api, page, snap } = await setup();
    page.pick('~/.claude-work');
    await api.fail(PICK, new ApiError(409, 'that Claude account cannot be used now', undefined, 'account-unusable'));
    expect(snap()).toMatchObject({ accounts: accounts(), picking: null, error: t.serverErrors['account-unusable'] });
  });

  it('picks nothing once released', async () => {
    const { api, page, release } = await setup();
    release();
    page.pick('~/.claude-work');
    expect(api.waiting()).toEqual([]);
  });

  it('moves the open sessions to the account in use and lists what the server says of them', async () => {
    const { api, page, snap } = await setup();
    page.move();
    expect(snap().moveAsked).toBe(true);
    page.move();
    expect(api.waiting()).toEqual([MOVE]);
    await api.answer(MOVE, accounts('~/.claude-work'));
    expect(snap()).toMatchObject({ accounts: accounts('~/.claude-work'), moveAsked: false, error: null });
    await vi.advanceTimersByTimeAsync(MOVES_POLL_MS * 2);
    expect(api.waiting()).toEqual([]);
  });

  it('asks again while sessions wait for their turn to end, until none do', async () => {
    const { api, page, snap } = await setup();
    page.move();
    await api.answer(MOVE, accounts('~/.claude-work', { moving: 2 }));
    await vi.advanceTimersByTimeAsync(MOVES_POLL_MS - 1);
    expect(api.waiting()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await api.answer(ACCOUNTS, accounts('~/.claude-work', { moving: 1 }));
    expect(snap().accounts?.moving).toBe(1);
    await vi.advanceTimersByTimeAsync(MOVES_POLL_MS);
    await api.fail(ACCOUNTS, new NetworkError());
    await vi.advanceTimersByTimeAsync(MOVES_POLL_MS);
    await api.answer(ACCOUNTS, accounts('~/.claude-work'));
    await vi.advanceTimersByTimeAsync(MOVES_POLL_MS * 2);
    expect(api.waiting()).toEqual([]);
  });

  it('asks again from the start when it opens with sessions waiting to move', async () => {
    const api = fakeApi();
    const page = createMacPage(api.api, 'en');
    const release = page.hold();
    await api.answer(GET, report());
    await api.answer(PROBLEMS, []);
    await api.answer(ACCOUNTS, accounts('~/.claude-work', { moving: 1 }));
    await vi.advanceTimersByTimeAsync(MOVES_POLL_MS);
    expect(api.waiting()).toEqual([ACCOUNTS]);
    await api.answer(ACCOUNTS, accounts('~/.claude-work', { moving: 1 }));
    await vi.advanceTimersByTimeAsync(MOVES_POLL_MS);
    release();
    await api.answer(ACCOUNTS, accounts('~/.claude-work', { moving: 1 }));
    await vi.advanceTimersByTimeAsync(MOVES_POLL_MS * 2);
    expect(api.waiting()).toEqual([]);
  });

  it('asks once at a time while sessions wait to move, whatever else answered the list', async () => {
    const { api, page } = await setup();
    page.move();
    await api.answer(MOVE, accounts('~/.claude-work', { moving: 2 }));
    await vi.advanceTimersByTimeAsync(MOVES_POLL_MS / 2);
    page.pick('~/.claude-work');
    await api.answer(PICK, accounts('~/.claude-work', { moving: 2 }));
    await vi.advanceTimersByTimeAsync(MOVES_POLL_MS);
    expect(api.waiting()).toEqual([ACCOUNTS]);
  });

  it('says why the open sessions could not be moved and keeps the list it had', async () => {
    const { api, page, snap } = await setup();
    page.move();
    await api.fail(MOVE, new ApiError(409, 'no Claude account was picked yet', undefined, 'account-none-picked'));
    expect(snap()).toMatchObject({ accounts: accounts(), moveAsked: false, error: t.serverErrors['account-none-picked'] });
  });

  it('moves nothing once released', async () => {
    const { api, page, release } = await setup();
    release();
    page.move();
    expect(api.waiting()).toEqual([]);
  });

  it('says why when the report cannot be loaded, and loads again on asking', async () => {
    const api = fakeApi();
    const page = createMacPage(api.api, 'en');
    page.hold();
    await api.fail(GET, new NetworkError());
    await api.answer(PROBLEMS, []);
    expect(page.getSnapshot().error).toBe(t.noServer);
    page.load();
    await api.answer(GET, report());
    await api.answer(PROBLEMS, []);
    expect(page.getSnapshot()).toMatchObject({ report: report(), error: null });
  });

  it('restarts, then waits through a server that is down until a new one says the restart ended', async () => {
    const { api, page, snap } = await setup();
    page.restart();
    expect(snap().op).toEqual({ kind: 'restart', phase: 'asking', message: null });
    await api.answer('POST /api/mac/restart', {});
    expect(snap().op?.phase).toBe('waiting');
    await vi.advanceTimersByTimeAsync(MAC_POLL_MS);
    await api.fail(GET, new ApiError(502, ''));
    await vi.advanceTimersByTimeAsync(MAC_POLL_MS);
    // The old server, still up, and its record of the restart not finished.
    await api.answer(GET, report({ lastOp: { op: 'restart', pid: 1, startedAt: 500 } }));
    expect(snap().op?.phase).toBe('waiting');
    await vi.advanceTimersByTimeAsync(MAC_POLL_MS);
    await api.answer(GET, report({ startedAt: 900, lastOp: { op: 'restart', pid: 1, startedAt: 500, finishedAt: 950, ok: true, message: 'The service restarted' } }));
    expect(snap().op).toEqual({ kind: 'restart', phase: 'done', message: null });
    expect(snap().report?.startedAt).toBe(900);
    await api.answer(PROBLEMS, []);
  });

  it("shows how a rollback failed in the Mac's words", async () => {
    const { api, page, snap } = await setup();
    page.rollback('a');
    expect(api.init('POST /api/mac/rollback')?.json).toEqual({ to: 'a' });
    await api.answer('POST /api/mac/rollback', {});
    await vi.advanceTimersByTimeAsync(MAC_POLL_MS);
    await api.answer(GET, report({ lastOp: { op: 'rollback', pid: 1, startedAt: 500, finishedAt: 600, ok: false, message: 'a did not come up; switched back to b' } }));
    expect(snap().op).toEqual({ kind: 'rollback', phase: 'failed', message: 'a did not come up; switched back to b' });
  });

  it('does not take the record of an earlier operation for this one', async () => {
    const earlier = { op: 'restart' as const, pid: 1, startedAt: 50, finishedAt: 60, ok: true };
    const api = fakeApi();
    const page = createMacPage(api.api, 'en');
    page.hold();
    await api.answer(GET, report({ lastOp: earlier }));
    await api.answer(PROBLEMS, []);
    page.restart();
    await api.answer('POST /api/mac/restart', {});
    await vi.advanceTimersByTimeAsync(MAC_POLL_MS);
    await api.answer(GET, report({ startedAt: 900, lastOp: earlier }));
    expect(page.getSnapshot().op?.phase).toBe('waiting');
  });

  it(`gives up waiting after ${MAC_WAIT_MS / 1000} seconds and says so`, async () => {
    const { api, page, snap } = await setup();
    page.restart();
    await api.answer('POST /api/mac/restart', {});
    for (let waited = 0; waited < MAC_WAIT_MS; waited += MAC_POLL_MS) {
      await vi.advanceTimersByTimeAsync(MAC_POLL_MS);
      if (api.waiting().includes(GET)) await api.fail(GET, new NetworkError());
    }
    expect(snap().op).toEqual({ kind: 'restart', phase: 'failed', message: t.macNoReturn });
    await vi.advanceTimersByTimeAsync(MAC_POLL_MS * 3);
    expect(api.waiting()).toEqual([]);
  });

  it('says by its code why the server refused', async () => {
    const { api, page, snap } = await setup();
    page.restart();
    await api.fail('POST /api/mac/restart', new ApiError(409, 'busy', undefined, 'op-busy'));
    expect(snap().op).toEqual({ kind: 'restart', phase: 'failed', message: t.serverErrors['op-busy'] });
  });

  it('starts nothing while an operation runs', async () => {
    const { api, page } = await setup();
    page.restart();
    page.rollback('a');
    expect(api.waiting()).toEqual(['POST /api/mac/restart']);
  });

  it('stops asking once released and changes nothing after', async () => {
    const { api, page, release, snap } = await setup();
    page.restart();
    await api.answer('POST /api/mac/restart', {});
    release();
    const before = snap();
    await vi.advanceTimersByTimeAsync(MAC_POLL_MS * 3);
    expect(api.waiting()).toEqual([]);
    expect(snap()).toBe(before);
  });
});
