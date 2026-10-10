import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/http/app.js';
import { hashPassword } from '../../../../src/http/auth/password.js';
import { LocalMachine } from '../../../../src/sessions/machine.js';
import { Store } from '../../../../src/system/store.js';
import { fakeCodexAppServer } from '../../../helpers/codexAppServer.js';
import { socketDir } from '../../../helpers/socketDir.js';
import { alive } from '../../../helpers/processes.js';
import { testTmux } from '../../../helpers/tmux.js';
import { ORIGIN, PASSWORD, RP_ID, signIn } from '../../../helpers/app.js';

// The routes for the Codex conversations had on this Mac, against a fake app server on a socket of the
// test's own; every Codex holding a thread is a process the test started.
const dir = socketDir('rc');
const { tmux } = testTmux(dir, 'rc');
const exe = (name: string, body: string) => {
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
  return join(dir, name);
};
const codexBin = exe('codex', 'exec sleep 600');
const claudeBin = exe('claude', `echo '[]'`);
const passwordHash = await hashPassword(PASSWORD);

const NEW = '0199aaaa-0000-7000-8000-00000000000a';
const OLD = '0199aaaa-0000-7000-8000-00000000000b';
const CLAUDE = '0b9c2a7e-1111-4222-8333-944445555666';
const now = Date.now();
const seconds = (ago: number) => (now - ago) / 1000;

type Row = { sessionId: string; [k: string]: unknown };

const started: ChildProcess[] = [];
const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const p of started.splice(0)) {
    try {
      process.kill(-p.pid!, 'SIGKILL');
    } catch {
      // gone already
    }
  }
  for (const c of closing.splice(0).reverse()) await c();
});
afterAll(() => tmux.killServer());

// The latest `count` items of a thread, given by the app server a page at a time as Codex does.
const pagedItems = (count: number, size = 200) => (params: Record<string, unknown>) => {
  const at = Number(params.cursor ?? 0);
  const data = Array.from({ length: Math.min(size, count - at) }, (_, i) => ({ item: { id: `i${at + i}`, type: 'agentMessage', text: `m${at + i}` } }));
  return { data, nextCursor: at + size < count ? String(at + size) : null };
};

const start = async (o: { items?: number; list?: () => unknown } = {}) => {
  const at = mkdtempSync(join(dir, 'c-'));
  const home = join(at, 'codex');
  mkdirSync(join(home, 'thread-writer-locks'), { recursive: true });
  const rollout = (id: string) => {
    const path = join(at, `${id}.jsonl`);
    writeFileSync(path, `${JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: `asked in ${id}` } })}\n`);
    utimesSync(path, new Date(0), new Date(0));
    return path;
  };
  const claudeRoot = join(at, 'claude-projects');
  mkdirSync(join(claudeRoot, '-proj'), { recursive: true });
  const transcript = join(claudeRoot, '-proj', `${CLAUDE}.jsonl`);
  writeFileSync(transcript, `${JSON.stringify({ type: 'user', cwd: '/work/proj', message: { content: 'hello there' } })}\n`);
  utimesSync(transcript, new Date(now - 2_000_000), new Date(now - 2_000_000));

  const sock = join(at, 'sock');
  const server = await fakeCodexAppServer(
    sock,
    [
      { id: OLD, cwd: at, name: 'Older one', source: 'cli', updatedAt: seconds(3_000_000), path: rollout(OLD) },
      { id: NEW, cwd: at, name: 'Fix the login', source: 'cli', updatedAt: seconds(1_000_000), path: rollout(NEW) },
    ],
    { ...(o.items !== undefined && { 'thread/items/list': pagedItems(o.items) }), ...(o.list && { 'thread/list': o.list }) },
  );
  const store = new Store(join(at, 'state.json'));
  store.update((s) => {
    s.user = { username: 'alice', hash: passwordHash };
  });
  const machine = new LocalMachine({
    tmux,
    store,
    claudeSettingsPath: '/dev/null',
    claudeBin,
    shell: '/bin/sh',
    journal: { file: join(at, 'journal.db'), log: () => {} },
    codex: { bin: codexBin, sock, home },
  });
  const { app } = await buildApp({ store, machine, origin: ORIGIN, rpId: RP_ID, auditPath: join(at, 'audit.log'), claudeProjectsRoot: claudeRoot });
  await app.listen({ port: 0, host: '127.0.0.1' });
  closing.push(() => server.close(), () => app.close());
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;

  let cookie = '';
  const api = (path: string, init: { method?: string; body?: unknown } = {}) =>
    fetch(base + path, {
      method: init.method,
      headers: { origin: ORIGIN, ...(cookie && { cookie }), ...(init.body !== undefined && { 'content-type': 'application/json' }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  cookie = await signIn(app);

  const recent = async () => (await (await api('/api/recent')).json()) as Row[];
  const row = async (id: string) => (await recent()).find((r) => r.sessionId === id);

  // A Codex holding the thread: node, as Codex is (ps shows no environment of the system's own programs).
  const holds = async (id: string, args = ['resume', id]) => {
    const lock = join(home, 'thread-writer-locks', `${id}.lock`);
    writeFileSync(lock, '');
    const fd = openSync(lock, 'r');
    const p = spawn(process.execPath, ['-e', "console.log('ready'); setInterval(() => {}, 1000)", ...args], { stdio: ['ignore', 'pipe', 'ignore', fd], detached: true });
    closeSync(fd);
    started.push(p);
    await new Promise((r) => p.stdout!.once('data', r));
    return p.pid!;
  };
  const runsTurn = (id: string) =>
    appendFileSync(join(at, `${id}.jsonl`), `${JSON.stringify({ timestamp: new Date(Date.now() + 1_000).toISOString(), type: 'event_msg', payload: { type: 'task_started', turn_id: 't' } })}\n`);
  return { api, recent, row, at, server, holds, runsTurn };
};

describe('GET /api/recent', () => {
  it("has the Claude and the Codex ones together, the latest first, each with what it is", async () => {
    const s = await start();
    const rows = await s.recent();
    expect(rows.map((r) => r.sessionId)).toEqual([NEW, CLAUDE, OLD]);
    expect(rows[0]).toEqual({
      sessionId: NEW,
      cwd: s.at,
      title: 'Fix the login',
      lastActivity: Math.round(seconds(1_000_000) * 1000),
      automated: false,
      openIn: null,
      background: false,
      lastPrompt: `asked in ${NEW}`,
      onMac: null,
      takingOver: false,
      folderGone: false,
      agent: 'codex',
    });
    expect(rows[1]).toMatchObject({ agent: 'claude', title: 'hello there' });
  });

  it('says which Codex one is open in a terminal here, which in another app, and which in a session here', async () => {
    const s = await start();
    await s.holds(NEW);
    await s.holds(OLD, ['app-server']);
    const made = await s.api('/api/m/local/sessions', { method: 'POST', body: { kind: 'codex', cwd: s.at, resumeId: NEW, takeOver: 'now' } });
    expect(made.status).toBe(201);
    const { id } = (await made.json()) as { id: string };
    expect(await s.row(NEW)).toMatchObject({ openIn: id, background: false });
    expect(await s.row(OLD)).toMatchObject({ openIn: null, background: true, onMac: null });
  });

  it('has a Codex one open in a terminal as idle there, or busy while it runs a turn', async () => {
    const s = await start();
    await s.holds(NEW);
    expect(await s.row(NEW)).toMatchObject({ onMac: { status: 'idle', terminals: 1 }, background: false });
    s.runsTurn(NEW);
    await expect.poll(() => s.row(NEW), { timeout: 8_000, interval: 200 }).toMatchObject({ onMac: { status: 'busy', terminals: 1 }, background: false });
  });

  it('marks a Codex one whose folder is gone', async () => {
    const s = await start({ list: () => ({ data: [{ id: OLD, cwd: '/no/such/worktree', name: 'Older one', source: 'cli', updatedAt: seconds(3_000_000) }] }) });
    expect(await s.row(OLD)).toMatchObject({ agent: 'codex', folderGone: true });
  });

  it('still has the Claude ones when Codex fails to list its own', async () => {
    const s = await start({
      list: () => {
        throw new Error('no state db');
      },
    });
    expect((await s.recent()).map((r) => r.sessionId)).toEqual([CLAUDE]);
  });
});

describe('GET /api/codex/threads/:id/chat', () => {
  // 450 items: three pages from the app server, more than one page of the route's 400.
  const page = async (s: Awaited<ReturnType<typeof start>>, query: string) => {
    const r = await s.api(`/api/codex/threads/${NEW}/chat${query}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { items: { text: string }[] };
    return { ...body, texts: body.items.map((i: { text: string }) => i.text) };
  };

  it('reads the whole thread from the app server, a page at a time', async () => {
    const s = await start({ items: 450 });
    const got = await page(s, `?sid=${NEW}`);
    expect(got.texts).toEqual(Array.from({ length: 450 }, (_, i) => `m${i}`));
    expect(s.server.calls.filter((c) => c.method === 'thread/items/list').map((c) => c.params.cursor)).toEqual([undefined, '200', '400']);
  });

  it.each<[string, string, { from: number; next: number }]>([
    ['the latest page when it is not asked for this thread', '', { from: 50, next: 450 }],
    ['the latest page when asked for another thread', `?sid=${OLD}&from=440`, { from: 50, next: 450 }],
    ['the latest page when asked from past its end', `?sid=${NEW}&from=451`, { from: 50, next: 450 }],
    ['what came since a place in it', `?sid=${NEW}&from=440`, { from: 440, next: 450 }],
    ['nothing new when asked from its end', `?sid=${NEW}&from=450`, { from: 450, next: 450 }],
    ['the page before a place in it', `?sid=${NEW}&before=100`, { from: 0, next: 100 }],
    ['the page before its end when asked before a place past it', `?sid=${NEW}&before=9999`, { from: 50, next: 450 }],
  ])('gives %s', async (_, query, want) => {
    const s = await start({ items: 450 });
    const got = await page(s, query);
    expect(got).toMatchObject({ sid: NEW, ...want, skipped: false });
    expect(got.texts).toEqual(Array.from({ length: want.next - want.from }, (_, i) => `m${want.from + i}`));
  });

  it.each([
    ['abc/chat', 'bad thread id'],
    [`${NEW}/chat?from=-1`, 'bad from'],
    [`${NEW}/chat?from=1.5`, 'bad from'],
    [`${NEW}/chat?from=x`, 'bad from'],
    [`${NEW}/chat?before=-1`, 'bad before'],
    [`${NEW}/chat?before=x`, 'bad before'],
  ])('refuses %s', async (path, error) => {
    const s = await start({ items: 10 });
    const r = await s.api(`/api/codex/threads/${path}`);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error });
    expect(s.server.calls.filter((c) => c.method === 'thread/items/list')).toEqual([]);
  });
});

describe('POST /api/m/:machine/sessions for a Codex conversation', () => {
  it('refuses while a Codex in a terminal has it, and takes it over when asked to', async () => {
    const s = await start();
    const pid = await s.holds(NEW);
    const spec = { kind: 'codex', cwd: s.at, resumeId: NEW };
    const refused = await s.api('/api/m/local/sessions', { method: 'POST', body: spec });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'open-on-mac' });
    expect(alive(pid)).toBe(true);
    const made = await s.api('/api/m/local/sessions', { method: 'POST', body: { ...spec, takeOver: 'now' } });
    expect(made.status).toBe(201);
    expect(await made.json()).toMatchObject({ kind: 'codex', codexThreadId: NEW });
    expect(alive(pid)).toBe(false);
  });

  it('takes it over at once when asked to once idle and the Codex there is idle', async () => {
    const s = await start();
    const pid = await s.holds(NEW);
    const made = await s.api('/api/m/local/sessions', { method: 'POST', body: { kind: 'codex', cwd: s.at, resumeId: NEW, takeOver: 'whenIdle' } });
    expect(made.status).toBe(201);
    expect(await made.json()).toMatchObject({ codexThreadId: NEW });
    expect(alive(pid)).toBe(false);
  });

  it('waits while the Codex there runs a turn, until the wait is called off', async () => {
    const s = await start();
    const pid = await s.holds(NEW);
    s.runsTurn(NEW);
    const waits = await s.api('/api/m/local/sessions', { method: 'POST', body: { kind: 'codex', cwd: s.at, resumeId: NEW, takeOver: 'whenIdle' } });
    expect(waits.status).toBe(202);
    expect(await waits.json()).toEqual({ waiting: true });
    expect(await s.row(NEW)).toMatchObject({ takingOver: true });
    expect((await s.api(`/api/codex/threads/${NEW}/take-over`, { method: 'DELETE' })).status).toBe(204);
    expect(await s.row(NEW)).toMatchObject({ takingOver: false });
    const again = await s.api(`/api/codex/threads/${NEW}/take-over`, { method: 'DELETE' });
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: 'not waiting' });
    expect(alive(pid)).toBe(true);
  });

  it.each<[string, (at: string) => object]>([
    ['a shell asked to take something over', (at) => ({ kind: 'shell', cwd: at, takeOver: 'now' })],
    ['a take-over that is neither now nor once idle', (at) => ({ kind: 'codex', cwd: at, resumeId: NEW, takeOver: 'later' })],
    ['a kind there is none of', (at) => ({ kind: 'gemini', cwd: at })],
    ['a Codex one with no folder', () => ({ kind: 'codex', resumeId: NEW })],
  ])('refuses %s', async (_, body) => {
    const s = await start();
    const r = await s.api('/api/m/local/sessions', { method: 'POST', body: body(s.at) });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'invalid session spec' });
  });
});
