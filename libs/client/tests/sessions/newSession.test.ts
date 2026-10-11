import { t } from '@workoffdesk/i18n';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type RecentConversation } from '../../src/base/api';
import { canGoOn, canPickUp, cancelTakeOver, createSession, goOnWith, pickUpOf, previewChatUrl, macConversation, recentConversations, recentFound, recentNote, takeOver } from '../../src/sessions/newSession';
import { aSession } from '../helpers/fakes';

const recent = (o: Partial<RecentConversation> & { sessionId: string }): RecentConversation => ({
  cwd: '/Users/me/project',
  title: 'A conversation',
  lastActivity: 0,
  automated: false,
  openIn: null,
  background: false,
  ...o,
});

describe('recentFound', () => {
  const all = [
    recent({ sessionId: 'login', title: 'Round the login buttons', cwd: '/Users/me/site' }),
    recent({ sessionId: 'nowhere', title: 'Round the corners', cwd: null }),
    recent({ sessionId: 'wake', title: 'MEM-705 nightly task', cwd: '/Users/me/agents', automated: true }),
    recent({ sessionId: 'blog', title: 'Blog post to pictures', cwd: '/Users/me/Blog' }),
  ];
  const ids = (rs: RecentConversation[]) => rs.map((r) => r.sessionId);

  it('drops a conversation with no folder, which cannot be started again', () => {
    const found = recentFound(all, '');
    expect([...ids(found.people), ...ids(found.programs)]).not.toContain('nowhere');
    expect(ids(found.people)).toEqual(['login', 'blog']);
  });

  it("keeps programs' conversations apart from people's", () => {
    const found = recentFound(all, '');
    expect(ids(found.programs)).toEqual(['wake']);
    expect(ids(found.people)).not.toContain('wake');
  });

  it.each([
    ['the title', 'login', ['login']],
    ['the folder', '/users/me/blog', ['blog']],
    ['any case', 'ROUND THE', ['login']],
    ['a search with spaces around it', '  blog  ', ['blog']],
  ])('finds by %s', (_, query, people) => {
    expect(ids(recentFound(all, query).people)).toEqual(people);
  });

  it("searches the programs' conversations too", () => {
    expect(ids(recentFound(all, 'mem-705').programs)).toEqual(['wake']);
    expect(recentFound(all, 'mem-705').people).toEqual([]);
  });
});

describe('canPickUp', () => {
  it.each([
    ['one no background session holds', { background: false, openIn: null }, true],
    ['one a background session holds', { background: true, openIn: null }, false],
    ['one a background session holds that is already open here', { background: true, openIn: 'abc123' }, true],
    ['one already open here', { background: false, openIn: 'abc123' }, true],
    ['one whose folder is gone', { folderGone: true, openIn: null }, false],
    ['one whose folder is gone that is already open here', { folderGone: true, openIn: 'abc123' }, true],
  ])('tells whether it can pick up %s', (_, o, can) => {
    expect(canPickUp(recent({ sessionId: 's', ...o }))).toBe(can);
  });
});

describe('createSession', () => {
  it('asks the Mac for a Claude in the folder, picking up the conversation it names', async () => {
    const made = { id: 'abc123' };
    const api = vi.fn(async () => made) as unknown as Api;
    const spec = { kind: 'claude' as const, cwd: '/Users/me/site', resumeId: 'login', title: 'Round the login buttons' };
    await expect(createSession(api, spec)).resolves.toBe(made);
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith('/api/m/local/sessions', { method: 'POST', json: spec });
  });
});

describe('goOnWith and canGoOn', () => {
  const claude = aSession({ id: 'abc123', kind: 'claude', cwd: '/work/app', claudeSessionId: 'conv-1' });
  const codex = aSession({ id: 'cdx456', kind: 'codex', cwd: '/work/app', codexThreadId: 'thread-1' });
  const went = { id: 'abc123' };

  it('asks the Mac to go on in the same session while it still has it', async () => {
    const api = vi.fn(async () => went) as unknown as Api;
    await expect(goOnWith(api, claude as typeof claude & { kind: 'claude' }, true)).resolves.toEqual({ session: went });
    expect(api).toHaveBeenCalledWith('/api/m/local/sessions/abc123/continue', { method: 'POST' });
  });

  it('brings a past session back in place, as the Mac keeps it', async () => {
    const api = vi.fn(async () => went) as unknown as Api;
    const past = { ...claude, past: true as const, status: 'ended' as const };
    await expect(goOnWith(api, past as typeof past & { kind: 'claude' }, false)).resolves.toEqual({ session: went });
    expect(api).toHaveBeenCalledWith('/api/m/local/sessions/abc123/continue', { method: 'POST' });
  });

  it.each([
    ['claude', claude, 'conv-1'],
    ['codex', codex, 'thread-1'],
  ] as const)('starts a %s picking up the conversation once the session is gone from the Mac', async (kind, s, resumeId) => {
    const api = vi.fn(async () => went) as unknown as Api;
    await expect(goOnWith(api, s as typeof s & { kind: typeof kind }, false)).resolves.toEqual({ session: went });
    expect(api).toHaveBeenCalledWith('/api/m/local/sessions', { method: 'POST', json: { kind, cwd: '/work/app', resumeId } });
  });

  it('leads to the conversation on the Mac when it is open in a terminal there', async () => {
    const api = vi.fn(async () => {
      throw new ApiError(409, 'open in Terminal', undefined, 'open-on-mac');
    }) as unknown as Api;
    await expect(goOnWith(api, codex as typeof codex & { kind: 'codex' }, true)).resolves.toEqual({ onMac: { agent: 'codex', sid: 'thread-1' } });
  });

  it.each<[string, ReturnType<typeof aSession>, ApiError]>([
    ['the Mac refused it otherwise', claude, new ApiError(409, 'busy', undefined, 'terminal-busy')],
    ['there is no conversation to lead to', aSession({ kind: 'claude' }), new ApiError(409, 'open in Terminal', undefined, 'open-on-mac')],
  ])('fails when %s', async (_, s, error) => {
    const api = vi.fn(async () => {
      throw error;
    }) as unknown as Api;
    await expect(goOnWith(api, s as typeof s & { kind: 'claude' }, true)).rejects.toBe(error);
  });

  it('allows it only for a session that holds a conversation', () => {
    expect([canGoOn(claude), canGoOn(codex), canGoOn(aSession({ kind: 'claude' })), canGoOn(aSession({ kind: 'codex', claudeSessionId: 'conv-1' })), canGoOn(aSession({ kind: 'shell' }))]).toEqual([true, true, false, false, false]);
  });
});

describe('macConversation', () => {
  it.each(['claude', 'codex'] as const)('asks the Mac for that one %s conversation, however old', async (agent) => {
    const row = recent({ sessionId: 'login', agent });
    const api = vi.fn(async () => row) as unknown as Api;
    await expect(macConversation(api, agent, 'login')).resolves.toBe(row);
    expect(api).toHaveBeenCalledWith(`/api/conversations/${agent}/login`);
  });

  it('is null when the Mac has none by that id, and throws when it cannot be asked', async () => {
    const none = vi.fn(async () => {
      throw new ApiError(404, 'no such conversation');
    }) as unknown as Api;
    await expect(macConversation(none, 'claude', 'gone')).resolves.toBeNull();
    const down = vi.fn(async () => {
      throw new ApiError(502, 'bad gateway');
    }) as unknown as Api;
    await expect(macConversation(down, 'claude', 'x')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('recentConversations', () => {
  const rows = [recent({ sessionId: 'login' })];

  it("asks for every agent's conversations", async () => {
    const api = vi.fn(async () => rows) as unknown as Api;
    await expect(recentConversations(api)).resolves.toBe(rows);
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith('/api/recent');
  });

  it('asks a server older than Codex support for the Claude ones only', async () => {
    const api = vi.fn(async (path: string) => {
      if (path === '/api/recent') throw new ApiError(404, 'not found');
      return rows;
    }) as unknown as Api;
    await expect(recentConversations(api)).resolves.toBe(rows);
    expect(api).toHaveBeenLastCalledWith('/api/claude/recent');
  });

  it.each([
    ['signed out', new ApiError(401, 'unauthorized')],
    ['a server that failed', new ApiError(500, 'boom')],
    ['a Mac that cannot be reached', new TypeError('Failed to fetch')],
  ])('says so when %s and asks nothing more', async (_, error) => {
    const api = vi.fn(async () => {
      throw error;
    }) as unknown as Api;
    await expect(recentConversations(api)).rejects.toBe(error);
    expect(api).toHaveBeenCalledTimes(1);
  });
});

describe('previewChatUrl', () => {
  it.each([
    ['claude', '/api/claude/sessions/abc/chat'],
    ['codex', '/api/codex/threads/abc/chat'],
  ] as const)('reads a %s conversation where its agent keeps it', (agent, url) => {
    expect(previewChatUrl(agent, 'abc')).toBe(url);
  });
});

describe('recentNote', () => {
  it.each([
    ['a Claude one', {}, ''],
    ['a Claude one open here', { openIn: 'abc123' }, t.alreadyOpen],
    ['a Claude one in a background session', { background: true }, t.inBackground],
    ['a Claude one in a background session and open here', { background: true, openIn: 'abc123' }, t.alreadyOpen],
    ['a Codex one', { agent: 'codex' }, 'Codex · '],
    ['a Codex one open here', { agent: 'codex', openIn: 'abc123' }, `Codex · ${t.alreadyOpen}`],
    ['a Codex one in another Codex app', { agent: 'codex', background: true }, `Codex · ${t.openElsewhere}`],
    ['one whose folder is gone', { folderGone: true }, t.folderGoneShort],
    ['one whose folder is gone, open here', { folderGone: true, openIn: 'abc123' }, t.alreadyOpen],
  ] as const)('describes %s as "%s"', (_, o, note) => {
    expect(recentNote(recent({ sessionId: 's', ...o }))).toBe(note);
  });
});

describe('pickUpOf', () => {
  it.each<[string, Partial<RecentConversation>, ReturnType<typeof pickUpOf>]>([
    ['opens the session already here', { openIn: 'abc123', background: true, onMac: { status: 'busy', terminals: 1 } }, { do: 'open', id: 'abc123' }],
    ['does nothing with one held where it cannot be gone on with', { background: true, onMac: { status: 'idle', terminals: 1 } }, { do: 'none' }],
    ['resumes one open nowhere', {}, { do: 'resume' }],
    ['says the folder of one open nowhere is gone', { folderGone: true }, { do: 'gone' }],
    ['says the folder of one open in a terminal on the Mac is gone, rather than take it over', { folderGone: true, onMac: { status: 'idle', terminals: 1 } }, { do: 'gone' }],
    ['opens one whose folder is gone that is already here', { folderGone: true, openIn: 'abc123' }, { do: 'open', id: 'abc123' }],
    ['takes over one open in terminals on the Mac', { onMac: { status: 'busy', terminals: 2 } }, { do: 'takeOver', status: 'busy', terminals: 2, waiting: false }],
    ['says a take-over is already waited on', { onMac: { status: 'busy', terminals: 1 }, takingOver: true }, { do: 'takeOver', status: 'busy', terminals: 1, waiting: true }],
  ])('%s', (_, o, pick) => {
    expect(pickUpOf(recent({ sessionId: 's', ...o }))).toEqual(pick);
  });
});

describe('takeOver', () => {
  it.each<[string, Partial<RecentConversation>, 'claude' | 'codex']>([
    ['a Claude one', {}, 'claude'],
    ['a Codex one', { agent: 'codex' }, 'codex'],
  ])('asks the Mac to take over %s, now or once idle', async (_, o, kind) => {
    const made = { id: 'abc123' };
    const api = vi.fn(async () => made) as unknown as Api;
    const r = { ...recent({ sessionId: 'login', ...o }), cwd: '/Users/me/site' };
    await expect(takeOver(api, r, 'whenIdle')).resolves.toBe(made);
    expect(api).toHaveBeenCalledWith('/api/m/local/sessions', { method: 'POST', json: { kind, cwd: '/Users/me/site', resumeId: 'login', takeOver: 'whenIdle' } });
  });

  it('returns no session while the Mac waits for it to be idle', async () => {
    const api = vi.fn(async () => ({ waiting: true })) as unknown as Api;
    await expect(takeOver(api, { ...recent({ sessionId: 'login' }), cwd: '/Users/me/site' }, 'whenIdle')).resolves.toBeNull();
  });
});

describe('cancelTakeOver', () => {
  it.each<[string, Partial<RecentConversation>, string]>([
    ['a Claude one', {}, '/api/claude/sessions/login/take-over'],
    ['a Codex one', { agent: 'codex' }, '/api/codex/threads/login/take-over'],
  ])('stops waiting to take over %s where its agent is', async (_, o, path) => {
    const api = vi.fn(async () => undefined) as unknown as Api;
    await cancelTakeOver(api, recent({ sessionId: 'login', ...o }));
    expect(api).toHaveBeenCalledWith(path, { method: 'DELETE' });
  });
});
