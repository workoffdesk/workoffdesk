import { createServer, request, type Server } from 'node:http';
import { mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountsView } from '../../../src/agents/claude/accounts.js';
import { askAccounts, askToMove, askToOpen, askToPick, startControlServer, watchActivity, type ControlAccounts, type OpenRequest } from '../../../src/sessions/control.js';
import { Conflict } from '../../../src/system/errors.js';
import { socketDir } from '../../helpers/socketDir.js';

// What a terminal on this Mac asks the running server for, over the server's own socket.
const dir = socketDir('ctl');
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

const VIEW: AccountsView = {
  accounts: [{ id: '', folder: '~/.claude', email: 'a@example.com', signedIn: true, ready: true, shared: true, limits: null }],
  inUse: '',
  picked: true,
  elsewhere: 2,
  moving: 1,
};
const start = async (open: (r: OpenRequest) => Promise<string> = async () => 'abcd1234', accounts: Partial<ControlAccounts> = {}) => {
  const sock = join(mkdtempSync(join(dir, 's-')), 'sock');
  const asked: OpenRequest[] = [];
  const picked: string[] = [];
  let moves = 0;
  // The machine's working count, and who it tells of a change.
  let working = 0;
  const listeners = new Set<() => void>();
  const server = await startControlServer(sock, {
    open: (r) => (asked.push(r), open(r)),
    accounts: { view: async () => VIEW, pick: async (id) => (picked.push(id), VIEW), move: async () => (moves++, VIEW), ...accounts },
    activity: { working: () => working, onChange: (cb) => (listeners.add(cb), () => listeners.delete(cb)), recheckMs: 50 },
  });
  servers.push(server);
  const setWorking = (n: number, told = true) => {
    working = n;
    if (told) listeners.forEach((cb) => cb());
  };
  return { sock, asked, picked, moves: () => moves, server, setWorking, listeners };
};

const counts = () => {
  const seen: number[] = [];
  const next = (n: number) => vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(n));
  return { seen, add: (n: number) => void seen.push(n), next };
};

const raw = (sock: string, o: { method?: string; path?: string; body?: string | Buffer }) =>
  new Promise<{ status: number; body: unknown }>((done, fail) => {
    const req = request({ socketPath: sock, method: o.method ?? 'POST', path: o.path ?? '/sessions' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', fail);
    req.end(o.body);
  });

describe('startControlServer and askToOpen', () => {
  it('answers the id of the session opened, with what it asked for passed on as it was', async () => {
    const s = await start();
    const r: OpenRequest = { kind: 'codex', cwd: '/work/proj', resumeId: '0199aaaa-0000-7000-8000-00000000000a', env: { TERM_PROGRAM: 'iTerm.app' } };
    expect(await askToOpen(s.sock, r)).toBe('abcd1234');
    expect(s.asked).toEqual([r]);
  });

  it('opens a Claude one when it names no kind', async () => {
    const s = await start();
    await askToOpen(s.sock, { cwd: '/work/proj' });
    expect(s.asked).toEqual([{ kind: undefined, cwd: '/work/proj', resumeId: undefined, env: undefined }]);
  });

  it('tells the terminal why the server could not open it', async () => {
    const s = await start(async () => {
      throw new Error('this conversation is open in a terminal on this Mac');
    });
    await expect(askToOpen(s.sock, { cwd: '/work/proj' })).rejects.toThrow('this conversation is open in a terminal on this Mac');
  });

  it.each<[string, object, string]>([
    ['no folder', { kind: 'claude' }, 'cwd required'],
    ['a folder that is not text', { cwd: 7 }, 'cwd required'],
    ['a conversation id that is not text', { cwd: '/work/proj', resumeId: 7 }, 'cwd required'],
    ['an environment that is a list', { cwd: '/work/proj', env: ['A=1'] }, 'env must be names to strings'],
    ['an environment with a value that is not text', { cwd: '/work/proj', env: { A: 1 } }, 'env must be names to strings'],
    ['a kind of session a terminal cannot ask for', { cwd: '/work/proj', kind: 'shell' }, 'kind must be claude or codex'],
  ])('refuses %s, and opens nothing', async (_, r, error) => {
    const s = await start();
    await expect(askToOpen(s.sock, r as OpenRequest)).rejects.toThrow(error);
    expect(s.asked).toEqual([]);
  });

  it.each<[string, { method?: string; path?: string; body?: string }, number, string]>([
    ['what is not JSON', { body: '{"cwd":' }, 400, 'bad json'],
    ['another path', { path: '/sessions/abcd1234', body: '{"cwd":"/work/proj"}' }, 404, 'not found'],
    ['another method', { method: 'PUT', body: '{"cwd":"/work/proj"}' }, 404, 'not found'],
  ])('answers %s with what is wrong, and opens nothing', async (_, o, status, error) => {
    const s = await start();
    expect(await raw(s.sock, o)).toEqual({ status, body: { error } });
    expect(s.asked).toEqual([]);
  });

  it('does not read an environment larger than a program on macOS can be given', async () => {
    const s = await start();
    const env = { BIG: 'x'.repeat(1024 * 1024) };
    await expect(askToOpen(s.sock, { cwd: '/work/proj', env })).rejects.toThrow();
    expect(s.asked).toEqual([]);
  });

  it('answers the Claude accounts, and picks one by its id', async () => {
    const s = await start();
    expect(await askAccounts(s.sock)).toEqual(VIEW);
    expect(await askToPick(s.sock, '/Users/someone/.claude-b')).toEqual(VIEW);
    expect(s.picked).toEqual(['/Users/someone/.claude-b']);
  });

  it('moves the open sessions to the account in use', async () => {
    const s = await start();
    expect(await askToMove(s.sock)).toEqual(VIEW);
    expect(s.moves()).toBe(1);
  });

  it('refuses a pick with no id, and picks nothing', async () => {
    const s = await start();
    expect(await raw(s.sock, { method: 'PUT', path: '/account', body: '{"id":7}' })).toEqual({ status: 400, body: { error: 'bad id' } });
    expect(s.picked).toEqual([]);
  });

  it('tells the terminal why, with the code the server gave', async () => {
    const s = await start(undefined, {
      move: async () => {
        throw new Conflict('no Claude account was picked yet', 'account-none-picked');
      },
    });
    await expect(askToMove(s.sock)).rejects.toMatchObject({ message: 'no Claude account was picked yet', code: 'account-none-picked' });
    expect(await raw(s.sock, { path: '/account/move' })).toEqual({ status: 409, body: { error: 'no Claude account was picked yet', code: 'account-none-picked' } });
  });

  it("listens on a socket only this Mac's user can open", async () => {
    const s = await start();
    expect(statSync(s.sock).mode & 0o777).toBe(0o600);
  });
});

describe('watchActivity', () => {
  it('tells how many sessions are working at once, then each time that number changes', async () => {
    const s = await start();
    s.setWorking(1, false);
    const c = counts();
    const w = watchActivity(s.sock, c.add);
    await c.next(1);
    s.setWorking(2);
    await c.next(2);
    s.setWorking(2);
    s.setWorking(0);
    await c.next(3);
    expect(c.seen).toEqual([1, 2, 0]);
    w.stop();
    await w.done;
  });

  it('sees a change no one was told of within a moment', async () => {
    const s = await start();
    const c = counts();
    const w = watchActivity(s.sock, c.add);
    await c.next(1);
    s.setWorking(3, false);
    await c.next(2);
    expect(c.seen).toEqual([0, 3]);
    w.stop();
    await w.done;
  });

  it('stops listening to the machine once the watcher goes away', async () => {
    const s = await start();
    const c = counts();
    const w = watchActivity(s.sock, c.add);
    await c.next(1);
    expect(s.listeners.size).toBe(1);
    w.stop();
    await w.done;
    await vi.waitFor(() => expect(s.listeners.size).toBe(0));
  });

  it('ends when the server goes, so the watcher can start again', async () => {
    const s = await start();
    const c = counts();
    const w = watchActivity(s.sock, c.add);
    await c.next(1);
    s.server.closeAllConnections();
    await w.done;
  });

  it('skips a line it cannot read', async () => {
    const sock = join(mkdtempSync(join(dir, 'b-')), 'sock');
    const server = createServer((_req, res) => res.end('nope\n{"working":2}\n'));
    await new Promise<void>((r) => server.listen(sock, r));
    servers.push(server);
    const c = counts();
    const w = watchActivity(sock, c.add);
    await w.done;
    expect(c.seen).toEqual([2]);
  });

  it('fails when no server listens', async () => {
    const w = watchActivity(join(mkdtempSync(join(dir, 'n-')), 'sock'), () => {});
    await expect(w.done).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
