import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

type Obj = Record<string, unknown>;

// Codex's app server as far as WorkOffDesk talks to it: JSON-RPC 2.0, one message per WebSocket frame, on a
// unix socket. It holds `threads` and answers each method as an idle app server would; `answers` overrides one,
// and one that throws is answered with an error. It tells its clients what `push` gives it, notifications and
// requests of its own, and keeps what they answer those with.
export async function fakeCodexAppServer(sock: string, threads: Obj[] = [], answers: Record<string, (params: Obj) => unknown> = {}) {
  const calls: { method: string; params: Obj }[] = [];
  const answered: { id: unknown; result: unknown }[] = [];
  const clients = new Set<WebSocket>();
  const thread = (id: unknown) => threads.find((t) => t.id === id);
  const answer = (method: string, params: Obj): unknown => {
    if (answers[method]) return answers[method](params);
    switch (method) {
      case 'thread/list':
        return { data: threads };
      case 'thread/read':
        return { thread: thread(params.threadId) ?? null };
      case 'thread/resume':
        return { thread: { ...thread(params.threadId), status: { type: 'idle' } } };
      case 'thread/items/list':
      case 'thread/loaded/list':
        return { data: [] };
      default:
        return {};
    }
  };
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { id?: string | number; method?: string; params?: Obj; result?: unknown };
      if (msg.id !== undefined && !msg.method) answered.push({ id: msg.id, result: msg.result });
      if (msg.id === undefined || !msg.method) return;
      calls.push({ method: msg.method, params: msg.params ?? {} });
      let reply: Obj;
      try {
        reply = { result: answer(msg.method, msg.params ?? {}) };
      } catch (e) {
        reply = { error: { code: -32603, message: e instanceof Error ? e.message : String(e) } };
      }
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...reply }));
    });
  });
  await new Promise<void>((resolve) => http.listen(sock, resolve));
  return {
    calls,
    answered,
    threads,
    push: (msg: { id?: string | number; method: string; params: Obj }) => {
      for (const c of clients) c.send(JSON.stringify({ jsonrpc: '2.0', ...msg }));
    },
    // Ends the line to every client, as an app server that died would.
    drop: () => {
      for (const c of clients) c.terminate();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of clients) c.terminate();
        wss.close();
        http.close(() => resolve());
      }),
  };
}
