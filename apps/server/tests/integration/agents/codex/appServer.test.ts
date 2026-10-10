import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { APP_SERVER_TMUX, connectAppServer, tuiCommand } from '../../../../src/agents/codex/appServer.js';
import { socketDir } from '../../../helpers/socketDir.js';
import { testTmux } from '../../../helpers/tmux.js';

// Starting Codex's app server, and the command a Codex session runs to use it.
const dir = socketDir('app');
type Msg = { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown };

const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closing.splice(0).reverse()) await c();
});

// Answers initialize; every other message goes to `on`, with the line to answer on.
const serve = async (on: (msg: Msg, ws: WebSocket) => void = () => {}) => {
  const sock = join(mkdtempSync(join(dir, 's-')), 'sock');
  const got: Msg[] = [];
  const lines: WebSocket[] = [];
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (ws) => {
    lines.push(ws);
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as Msg;
      got.push(msg);
      if (msg.method === 'initialize') ws.send(JSON.stringify({ id: msg.id, result: { userAgent: 'codex-test' } }));
      else on(msg, ws);
    });
  });
  await new Promise<void>((r) => http.listen(sock, r));
  const close = () =>
    new Promise<void>((r) => {
      for (const ws of lines) ws.terminate();
      wss.close();
      http.close(() => r());
    });
  closing.push(close);
  return { sock, got, lines, close };
};

describe('tuiCommand', () => {
  it.each([
    ['a new one', undefined, []],
    ['one going on with a thread', '0199aaaa-0000-7000-8000-00000000000a', ['resume', '0199aaaa-0000-7000-8000-00000000000a']],
  ])("gives Codex's TUI for %s on the shared app server, in the session's folder whatever its name", (_, resume, more) => {
    const args = join(dir, 'args');
    writeFileSync(args, `#!/bin/sh\nprintf '%s\\n' "$@"\n`);
    chmodSync(args, 0o755);
    const cwd = "/work/it's $HOME `here`";
    const said = execFileSync('/bin/sh', ['-c', tuiCommand({ sock: '/run/codex.sock', codexBin: args, shell: '/bin/sh', cwd, resume })], { encoding: 'utf8', input: '' });
    expect(said.split('\n').slice(0, -1)).toEqual(['--remote', 'unix:///run/codex.sock', '-C', cwd, '-c', 'check_for_update_on_startup=false', ...more]);
  });
});

describe('connectAppServer', () => {
  const { tmux } = testTmux(dir, 'rpc');
  afterAll(() => tmux.killServer());
  // A Codex whose app server answers initialize on the socket it is told to listen on.
  const fakeCodex = () => {
    const ws = createRequire(import.meta.url).resolve('ws');
    const js = join(dir, 'app-server.cjs');
    writeFileSync(
      js,
      `const { WebSocketServer } = require(${JSON.stringify(ws)});
const http = require('node:http').createServer();
new WebSocketServer({ server: http }).on('connection', (s) => s.on('message', (d) => { const m = JSON.parse(String(d)); if (m.id !== undefined) s.send(JSON.stringify({ id: m.id, result: {} })); }));
http.listen(process.argv[2].replace('unix://', ''));
`,
    );
    const bin = join(dir, 'codex');
    writeFileSync(bin, `#!/bin/sh\n[ "$1 $2" = "app-server --listen" ] || exit 2\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(js)} "$3"\n`);
    chmodSync(bin, 0o755);
    return bin;
  };

  it('starts none when the one running answers on the socket, which goes on running', async () => {
    const running = join(dir, 'running.pid');
    await tmux.newSession(APP_SERVER_TMUX, { cwd: dir, command: `/bin/sh -c 'echo $$ > ${running}; exec sleep 600'`, env: {} });
    await vi.waitFor(() => expect(readFileSync(running, 'utf8')).toMatch(/^\d+\n$/));
    const s = await serve();
    const rpc = await connectAppServer({ tmux, sock: s.sock, codexBin: '/bin/false', shell: '/bin/sh' });
    closing.push(async () => rpc.close());
    expect(rpc.open).toBe(true);
    expect(() => process.kill(Number(readFileSync(running, 'utf8')), 0)).not.toThrow();
    await tmux.killSession(APP_SERVER_TMUX);
  });

  it('starts one in a tmux session of its own when nothing answers, in place of one left from before', { timeout: 20_000 }, async () => {
    const left = join(dir, 'left.pid');
    await tmux.newSession(APP_SERVER_TMUX, { cwd: dir, command: `/bin/sh -c 'echo $$ > ${left}; exec sleep 600'`, env: {} });
    await vi.waitFor(() => expect(readFileSync(left, 'utf8')).toMatch(/^\d+\n$/));
    const sock = join(mkdtempSync(join(dir, 'a-')), 'sock');
    const rpc = await connectAppServer({ tmux, sock, codexBin: fakeCodex(), shell: '/bin/sh' });
    closing.push(async () => rpc.close());
    expect(rpc.open).toBe(true);
    expect(await tmux.hasSession(APP_SERVER_TMUX)).toBe(true);
    expect(() => process.kill(Number(readFileSync(left, 'utf8')), 0)).toThrow();
  });
});
