import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { CodexRpc, RpcError, type Notification, type ServerRequest } from '../../../../src/agents/codex/rpc.js';
import { socketDir } from '../../../helpers/socketDir.js';

// The client of Codex's app server, against a server of the test's own that says what each test needs.
const dir = socketDir('rpc');
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
const connect = async (sock: string) => {
  const rpc = await CodexRpc.connect(sock);
  closing.push(async () => rpc.close());
  return rpc;
};
const send = (ws: WebSocket, msg: object | string) => ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));

describe('CodexRpc', () => {
  describe('connecting to the app server', () => {
    it('introduces this client, then says it is ready', async () => {
      const s = await serve();
      const rpc = await connect(s.sock);
      expect(rpc.open).toBe(true);
      await vi.waitFor(() => expect(s.got).toHaveLength(2));
      expect(s.got[0]).toMatchObject({ method: 'initialize', params: { clientInfo: { name: 'workoffdesk', title: 'WorkOffDesk' }, capabilities: { experimentalApi: true } } });
      expect(s.got[1]).toEqual({ method: 'initialized' });
    });

    it('reaches a socket by the link to it Codex keeps where the path is too long for one', async () => {
      const s = await serve();
      const deep = join(dir, 'a-folder-whose-name-is-long-enough', 'and-another-one-inside-it-as-long', 'and-a-third-to-pass-104-bytes');
      mkdirSync(deep, { recursive: true });
      const link = join(deep, 'codex.sock');
      expect(Buffer.byteLength(link)).toBeGreaterThan(104);
      symlinkSync(s.sock, link);
      expect((await connect(link)).open).toBe(true);
    });

    it.each([
      ['nothing is at the socket', () => join(dir, 'none')],
      ['nothing listens on it', () => {
        const sock = join(mkdtempSync(join(dir, 'd-')), 'sock');
        writeFileSync(sock, '');
        return sock;
      }],
    ])('fails when %s', async (_, sock) => {
      await expect(CodexRpc.connect(sock())).rejects.toThrow();
    });
  });

  describe('asking the app server', () => {
    it('gives its answer to each request, matched by id whatever the order they come in', async () => {
      const held: Msg[] = [];
      const s = await serve((msg, ws) => {
        if (msg.id === undefined) return;
        held.push(msg);
        if (held.length === 2) for (const m of held.reverse()) send(ws, { id: m.id, result: { echo: m.params } });
      });
      const rpc = await connect(s.sock);
      const [a, b] = await Promise.all([rpc.request('thread/read', { n: 1 }), rpc.request('thread/read', { n: 2 })]);
      expect([a, b]).toEqual([{ echo: { n: 1 } }, { echo: { n: 2 } }]);
    });

    it('gives nothing in particular for an answer with no result', async () => {
      const s = await serve((msg, ws) => send(ws, { id: msg.id }));
      expect(await (await connect(s.sock)).request('thread/unsubscribe', {})).toEqual({});
    });

    it.each([
      ['its code and message', { code: -32602, message: 'invalid params' }, { code: -32602, message: 'invalid params' }],
      ['what stands for them when it gives none', {}, { code: 0, message: 'error' }],
    ])('fails with an error the app server answers, by %s', async (_, error, want) => {
      const s = await serve((msg, ws) => send(ws, { id: msg.id, error }));
      const failed = await (await connect(s.sock)).request('thread/resume', {}).catch((e: unknown) => e);
      expect(failed).toBeInstanceOf(RpcError);
      expect(failed).toMatchObject(want);
    });

    it('fails when no answer comes in time, and takes no notice of one that comes after', async () => {
      let late: (() => void) | undefined;
      const s = await serve((msg, ws) => {
        late = () => send(ws, { id: msg.id, result: { late: true } });
      });
      const rpc = await connect(s.sock);
      await expect(rpc.request('thread/list', {}, 50)).rejects.toMatchObject({ code: RpcError.TIMEOUT, message: 'thread/list did not answer in time' });
      late!();
      expect(rpc.open).toBe(true);
    });

    it('takes no notice of what is not JSON, or answers no request, and goes on working', async () => {
      const s = await serve((msg, ws) => {
        send(ws, 'not json');
        send(ws, { id: 'wod-999', result: { stray: true } });
        send(ws, { result: { no: 'id' } });
        send(ws, { id: msg.id, result: { ok: true } });
      });
      expect(await (await connect(s.sock)).request('thread/read', {})).toEqual({ ok: true });
    });
  });

  describe('what the app server says unasked', () => {
    it('tells it as notifications and requests, with params that are not an object as none', async () => {
      const s = await serve();
      const rpc = await connect(s.sock);
      const notified: Notification[] = [];
      const requested: ServerRequest[] = [];
      rpc.onNotification((n) => notified.push(n));
      rpc.onRequest((r) => requested.push(r));
      send(s.lines[0], { method: 'turn/started', params: { threadId: 't1' } });
      send(s.lines[0], { method: 'thread/status/changed', params: 'idle' });
      send(s.lines[0], { id: 7, method: 'item/commandExecution/requestApproval', params: { command: 'ls' } });
      await vi.waitFor(() => expect(requested).toHaveLength(1));
      expect(notified).toEqual([
        { method: 'turn/started', params: { threadId: 't1' } },
        { method: 'thread/status/changed', params: {} },
      ]);
      expect(requested).toEqual([{ id: 7, method: 'item/commandExecution/requestApproval', params: { command: 'ls' } }]);
    });

    it("answers it by the request's own id", async () => {
      const s = await serve();
      const rpc = await connect(s.sock);
      expect(rpc.respond(7, { decision: 'accept' })).toBe(true);
      await vi.waitFor(() => expect(s.got).toContainEqual({ id: 7, result: { decision: 'accept' } }));
    });
  });

  describe('when the app server goes away', () => {
    it('fails what was asked of it and not answered, and says it closed', async () => {
      const s = await serve();
      const rpc = await connect(s.sock);
      const closed = vi.fn();
      rpc.onClose(closed);
      const asked = rpc.request('thread/list', {});
      await vi.waitFor(() => expect(s.got.map((m) => m.method)).toContain('thread/list'));
      s.lines[0].terminate();
      await expect(asked).rejects.toMatchObject({ code: RpcError.CLOSED });
      expect(closed).toHaveBeenCalledTimes(1);
      expect(rpc.open).toBe(false);
    });

    it('fails at once what is asked of it after, and answers no request', async () => {
      const s = await serve();
      const rpc = await connect(s.sock);
      const closed = new Promise<void>((r) => rpc.onClose(r));
      rpc.close();
      await closed;
      await expect(rpc.request('thread/list', {})).rejects.toMatchObject({ code: RpcError.CLOSED, message: 'codex app server closed' });
      expect(rpc.respond(7, {})).toBe(false);
    });
  });
});
