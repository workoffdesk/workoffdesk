import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../../src/http/app.js';
import { LocalMachine } from '../../src/sessions/machine.js';
import { Pusher } from '../../src/notify/push.js';
import { Store } from '../../src/system/store.js';
import { addUser, ORIGIN, PASSWORD, RP_ID } from './app.js';
import { testTmux } from './tmux.js';

type Running = { base: string; wsBase: string; close: () => Promise<void> };

// The whole server on a port of its own and a tmux server of its own, as a phone reaches it: over HTTP and
// WebSockets, signed in as alice once `cookie` is set. It starts before the file's tests and stops after them;
// `start` runs another server on the same store and tmux, as a restart does.
// claudeBin: what runs as Claude; unset, the claude on the PATH, which a test does not have, so a Claude session ends.
export function liveServer(name: string, o: { signedIn?: boolean; claudeBin?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `ts-${name}-`));
  const { tmux, socket, conf } = testTmux(dir, name);
  const store = new Store(join(dir, 'state.json'));
  const auditPath = join(dir, 'audit.log');
  const claudeRoot = join(dir, 'claude-projects');
  const claudeJobsRoot = join(dir, 'claude-jobs');
  const claudeDir = join(dir, 'claude-config');
  const uploadsDir = join(dir, 'uploads');
  for (const d of [claudeRoot, claudeJobsRoot, claudeDir]) mkdirSync(d, { recursive: true });

  async function start(): Promise<Running> {
    const machine = new LocalMachine({ tmux, store, claudeSettingsPath: '/dev/null', shell: '/bin/sh', claudeBin: o.claudeBin });
    const pusher = new Pusher(store, { subject: 'mailto:t@example.test', send: async () => {} });
    const { app } = await buildApp({
      store,
      machine,
      origin: ORIGIN,
      rpId: RP_ID,
      auditPath,
      pusher,
      claudeProjectsRoot: claudeRoot,
      claudeJobsRoot,
      claudeDir,
      pinnedDirs: ['/pinned/dir'],
      media: { uploadsDir },
    });
    const stopWatch = machine.watch(500);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as any).port;
    const close = async () => {
      stopWatch();
      await app.close();
    };
    return { base: `http://127.0.0.1:${port}`, wsBase: `ws://127.0.0.1:${port}`, close };
  }

  const api = (path: string, init: RequestInit & { origin?: string | null } = {}) => {
    const headers: Record<string, string> = { ...(init.headers as any) };
    if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
    if (live.cookie && !headers.cookie) headers.cookie = live.cookie;
    if (init.body) headers['content-type'] = 'application/json';
    return fetch(live.server.base + path, { ...init, headers });
  };

  const login = async (password = PASSWORD, ip = '7.7.7.7') =>
    api('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password }),
      headers: { 'cf-connecting-ip': ip },
    });

  function openWs(path: string, opts: { cookie?: string; origin?: string } = {}) {
    const ws = new WebSocket(live.server.wsBase + path, {
      headers: { origin: opts.origin ?? ORIGIN, cookie: opts.cookie ?? live.cookie },
    });
    ws.binaryType = 'nodebuffer';
    let text = '';
    const control: any[] = [];
    ws.on('message', (d: Buffer, isBinary) => {
      if (isBinary) text += d.toString('utf8');
      else control.push(JSON.parse(d.toString()));
    });
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    const opened = new Promise<void>((r, j) => {
      ws.on('open', () => r());
      ws.on('error', j);
    });
    return { ws, opened, closed, out: () => text, control };
  }

  const live = {
    dir,
    tmux,
    socket,
    conf,
    store,
    auditPath,
    claudeRoot,
    claudeJobsRoot,
    claudeDir,
    uploadsDir,
    cookie: '',
    server: undefined as unknown as Running,
    start,
    api,
    login,
    openWs,
  };

  beforeAll(async () => {
    await addUser(store);
    store.update((s) => {
      s.vapid = { publicKey: 'BPUBLICKEY', privateKey: 'priv' };
    });
    live.server = await start();
    if (o.signedIn) live.cookie = (await login()).headers.get('set-cookie')!.split(';')[0];
  });
  afterAll(async () => {
    await live.server.close();
    await tmux.killServer();
  });
  return live;
}
