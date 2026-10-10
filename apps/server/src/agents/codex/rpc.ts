import { realpathSync } from 'node:fs';
import WebSocket from 'ws';
import { VERSION } from '../../system/version.js';

export type RequestId = string | number;
export type Notification = { method: string; params: Record<string, unknown> };
export type ServerRequest = { id: RequestId; method: string; params: Record<string, unknown> };

export class RpcError extends Error {
  // Codes of this client's own: the connection closed, or no answer came in time.
  static readonly CLOSED = -1;
  static readonly TIMEOUT = -2;
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

const REQUEST_MS = 15_000;
const CONNECT_MS = 5_000;

// A client of Codex's app server: JSON-RPC 2.0 messages, one per WebSocket frame, over its unix socket.
export class CodexRpc {
  private seq = 0;
  private readonly pending = new Map<RequestId, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private readonly notified = new Set<(n: Notification) => void>();
  private readonly requested = new Set<(r: ServerRequest) => void>();
  private readonly closed = new Set<() => void>();

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => this.receive(String(data)));
    ws.on('close', () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new RpcError(RpcError.CLOSED, 'codex app server closed'));
      }
      this.pending.clear();
      for (const cb of this.closed) cb();
    });
    ws.on('error', () => {});
  }

  // Connected and introduced; throws when nothing listens on the socket.
  static async connect(sock: string): Promise<CodexRpc> {
    // Codex keeps a socket whose path is too long behind a symlink, which a unix socket address cannot follow.
    const path = realpathSync(sock);
    const ws = new WebSocket(`ws+unix://${path}:/`, { handshakeTimeout: CONNECT_MS });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const rpc = new CodexRpc(ws);
    await rpc.request('initialize', { clientInfo: { name: 'workoffdesk', title: 'WorkOffDesk', version: VERSION }, capabilities: { experimentalApi: true } });
    rpc.send({ method: 'initialized' });
    return rpc;
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  request<T = Record<string, unknown>>(method: string, params: object, timeoutMs = REQUEST_MS): Promise<T> {
    const id = `wod-${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(RpcError.TIMEOUT, `${method} did not answer in time`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      if (!this.send({ id, method, params })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new RpcError(RpcError.CLOSED, 'codex app server closed'));
      }
    });
  }

  respond(id: RequestId, result: unknown): boolean {
    return this.send({ id, result });
  }

  onNotification(cb: (n: Notification) => void): void {
    this.notified.add(cb);
  }

  onRequest(cb: (r: ServerRequest) => void): void {
    this.requested.add(cb);
  }

  onClose(cb: () => void): void {
    this.closed.add(cb);
  }

  close(): void {
    this.ws.close();
  }

  private send(msg: object): boolean {
    if (!this.open) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private receive(text: string): void {
    let msg: { id?: RequestId; method?: unknown; params?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>;
    if (typeof msg.method === 'string') {
      if (msg.id === undefined) for (const cb of this.notified) cb({ method: msg.method, params });
      else for (const cb of this.requested) cb({ id: msg.id, method: msg.method, params });
      return;
    }
    if (msg.id === undefined) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new RpcError(Number(msg.error.code ?? 0), String(msg.error.message ?? 'error')));
    else p.resolve(msg.result ?? {});
  }
}
