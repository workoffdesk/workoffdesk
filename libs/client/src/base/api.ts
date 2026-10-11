import { t } from '@workoffdesk/i18n';
import { heardDate } from './clock';
import { isTransient, SEND_RETRY_DELAYS, withRetry } from './retry';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

// A request that got no answer from the server: refused, dropped or given up on. A TypeError, as a
// browser's fetch throws, so it is retried like one (retry.ts).
export class NetworkError extends TypeError {}

// A write that was sent and never answered: the server may or may not have done it, so it is neither tried
// again (not a TypeError) nor said to have not arrived.
export class NoAnswer extends Error {}

// What went wrong, to show, always in words: what the server said (in the phone's words when it named a
// code), that the server cannot be reached (in the caller's words, if it has them), or the caller's
// fallback. Never what a platform or a page said.
export function errorText(e: unknown, fallback: string, unreachable: string = t.noServer): string {
  if (e instanceof NoAnswer) return t.noAnswer;
  if (e instanceof NetworkError) return unreachable;
  if (!(e instanceof ApiError)) return fallback;
  if (e.code && t.serverErrors[e.code]) return t.serverErrors[e.code];
  if (e.status === 404 && e.message) return t.goneOnMac;
  if (e.message) return e.message;
  return isTransient(e.status) ? unreachable : fallback;
}

// What differs between the web app and the iPhone app: where the server is, and how a request is signed in.
export type ApiConfig = {
  // The server's address, like https://workoffdesk.example.com.
  base: () => string;
  // Headers that sign a request in; none in a browser, where the cookie does it.
  headers?: () => Record<string, string>;
  // A request outside the sign-in routes was refused for want of a login; sent: the headers it went with.
  onUnauthorized: (sent: Headers) => void;
  // The release of the server that answered, told with every answer.
  onVersion?: (version: string) => void;
  // A try at a request that took SLOW_MS or more, however it ended, for someone to find where the time goes.
  onSlow?: (slow: Slow) => void;
};

export const SLOW_MS = 2000;
// outcome: the status the server answered, or 'network' when no answer came (a timeout among them).
export type Slow = { method: string; path: string; ms: number; outcome: number | 'network' };

// A socket opening from now, told as a request is when it took SLOW_MS or more: settle it once it opened
// (101) or closed before it did ('network'); only the first settling counts.
export function socketOpening(path: string, onSlow: ((slow: Slow) => void) | undefined): (outcome: Slow['outcome']) => void {
  const started = Date.now();
  let settled = false;
  return (outcome) => {
    if (settled) return;
    settled = true;
    const ms = Date.now() - started;
    if (ms >= SLOW_MS) onSlow?.({ method: 'WS', path, ms, outcome });
  };
}

// idempotent: a write the server takes once however often it arrives (a message under its id), so one
// that hangs can be given up on and sent again like a read.
export type ApiInit = RequestInit & { json?: unknown; idempotent?: boolean };

// A phone back from the background can hold a connection that is dead without knowing it, and a read on it
// never answers: given up after this long, it is a failure on the way like any other, and tried again.
const READ_TIMEOUT_MS = 8000;
// A write may take the Mac longer (a message is typed in before it answers).
const WRITE_TIMEOUT_MS = 15_000;
// An upload is also given the time its bytes take on a slow mobile line.
const SLOWEST_UPLOAD_BYTES_PER_MS = 25;
const WRITES = new Set(['POST', 'PUT', 'PATCH']);

const bodySize = (body: BodyInit | null | undefined) =>
  body instanceof Blob
    ? body.size
    : typeof body === 'string'
      ? body.length
      : body instanceof ArrayBuffer || ArrayBuffer.isView(body)
        ? body.byteLength
        : 0;

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>, timedOut = () => new NetworkError('timed out')): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch (e) {
    throw controller.signal.aborted ? timedOut() : e;
  } finally {
    clearTimeout(timer);
  }
}

export function createApi(config: ApiConfig) {
  const signIn = () => config.headers?.() ?? {};

  async function request<T>(path: string, init: RequestInit & { json?: unknown }): Promise<T> {
    const started = Date.now();
    let outcome: Slow['outcome'] = 'network';
    try {
      return await answer<T>(path, init, (status) => (outcome = status));
    } finally {
      const ms = Date.now() - started;
      if (ms >= SLOW_MS) config.onSlow?.({ method: init.method ?? 'GET', path: path.split('?')[0], ms, outcome });
    }
  }

  async function answer<T>(path: string, init: RequestInit & { json?: unknown }, answered: (status: number) => void): Promise<T> {
    const { json: given, ...rest } = init;
    // A write with nothing to say goes as an empty object: iOS gives a POST with no body a content type the
    // server has no parser for, and it answers 415.
    const json = given === undefined && rest.body == null && WRITES.has(rest.method ?? 'GET') ? {} : given;
    const headers = new Headers(rest.headers);
    for (const [k, v] of Object.entries(signIn())) if (!headers.has(k)) headers.set(k, v);
    if (json !== undefined) headers.set('content-type', 'application/json');
    let res: Response;
    const sent = Date.now();
    try {
      res = await fetch(config.base() + path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
    } catch (e) {
      throw new NetworkError((e as Error | null)?.message ?? 'fetch failed', { cause: e });
    }
    answered(res.status);
    heardDate(res.headers.get('date'), sent, Date.now());
    const version = res.headers.get('x-workoffdesk-version');
    if (version) config.onVersion?.(version);
    if (res.status === 401 && !path.startsWith('/api/auth/')) config.onUnauthorized(headers);
    if (!res.ok) {
      // Only what the server itself said: a proxy's page or status text is not for the screen.
      let msg = '';
      let code: string | undefined;
      try {
        const body = await res.json();
        msg = body.error ?? msg;
        code = typeof body.code === 'string' ? body.code : undefined;
      } catch {
        // non-JSON error body
      }
      throw new ApiError(res.status, msg, Number(res.headers.get('retry-after')) || undefined, code);
    }
    if (res.status === 204) return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('json') ? res.json() : res.text()) as Promise<T>;
  }

  return {
    // Reads and deletes ride out a passing blip (see retry.ts): a delete that arrives twice is still one
    // delete. Any other write is sent once, since it may have arrived, unless it is idempotent. Every
    // request is given up on in time.
    api<T = unknown>(path: string, { idempotent, ...init }: ApiInit = {}): Promise<T> {
      const method = init.method ?? 'GET';
      if (method === 'GET' || method === 'DELETE')
        return withRetry(() => withTimeout(READ_TIMEOUT_MS, (signal) => request<T>(path, { signal, ...init })));
      const bound = WRITE_TIMEOUT_MS + bodySize(init.body) / SLOWEST_UPLOAD_BYTES_PER_MS;
      if (idempotent) return withRetry(() => withTimeout(bound, (signal) => request<T>(path, { signal, ...init })), { delays: SEND_RETRY_DELAYS });
      return withTimeout(bound, (signal) => request<T>(path, { signal, ...init }), () => new NoAnswer('no answer'));
    },
    wsUrl: (path: string) => config.base().replace(/^http/, 'ws') + path,
    // For what is not a fetch, such as a socket that takes headers.
    signIn,
  };
}

// A server address as typed into the app, made a base URL: https unless it says otherwise, without a
// trailing slash. Null when it is not an address.
export function serverBase(typed: string): string | null {
  const s = typed.trim();
  const m = /^(?:(https?):\/\/)?([a-z0-9.-]+|\[[0-9a-f:.]+\])(:\d{1,5})?(\/[^?#\s]*)?$/i.exec(s);
  if (!m) return null;
  return `${(m[1] ?? 'https').toLowerCase()}://${m[2].toLowerCase()}${m[3] ?? ''}${(m[4] ?? '').replace(/\/+$/, '')}`;
}

// What a client asks the server with: see createApi.
export type Api = ReturnType<typeof createApi>['api'];

export type ClaudeStatus = 'starting' | 'working' | 'waiting' | 'idle' | 'ended' | 'compacting';

// A message sent while Claude could not take it, waiting on the Mac in the order it was sent.
export type Queued = { id: string; text: string; at: number };

// What Claude Code's status line last reported of a session; resetsAt in Unix seconds.
export type Limit = { used: number; resetsAt?: number };
export type Usage = {
  model?: string;
  effort?: string;
  context?: number;
  fiveHour?: Limit;
  sevenDay?: Limit;
  cost?: number;
  added?: number;
  removed?: number;
};

export type SessionKind = 'shell' | 'claude' | 'codex';
export type Agent = 'claude' | 'codex';

// A session that runs an agent (Claude Code or Codex) the chat talks to, rather than a shell.
export const isAgent = (kind: SessionKind | undefined | null): kind is Agent => kind === 'claude' || kind === 'codex';
// What a session's agent is called on the screen.
export const agentName = (kind: SessionKind | undefined | null): string => (kind === 'codex' ? 'Codex' : 'Claude');

export type TermSession = {
  id: string;
  title: string;
  kind: SessionKind;
  cwd: string;
  claudeSessionId?: string;
  codexThreadId?: string;
  createdAt: number;
  lastActivity: number;
  status: ClaudeStatus | null;
  usage?: Usage | null;
  // The Claude account it runs on, by its email; only on a Mac with more than one.
  claudeAccount?: string;
  // Only in the live list: what Claude said last, as plain words.
  lastReply?: string | null;
  // Gone from the Mac's tmux and kept there, to read and go on with, until deleted.
  past?: true;
};

// A Claude or Codex conversation people had on this Mac. `automated`: started by a program (an agent runner
// such as Paperclip), not by a person. background: held where it cannot be gone on with here (a Claude
// background session, another Codex app). lastPrompt: what the person said last. onMac: open in a terminal
// on the Mac other than workoffdesk's (in `terminals` of them), and what the agent does there (background: its
// turn is over, only commands it left running go on); takingOver:
// waited on to be idle there to go on here. agent: missing means Claude. The last four are missing from a
// list kept from an older server.
export type MacStatus = 'idle' | 'busy' | 'background' | 'waiting';
export type RecentConversation = {
  sessionId: string;
  cwd: string | null;
  title: string;
  lastActivity: number;
  automated: boolean;
  openIn: string | null;
  background: boolean;
  lastPrompt?: string | null;
  onMac?: { status: MacStatus; terminals: number } | null;
  takingOver?: boolean;
  // Its folder is not on the Mac any more (a worktree removed): it cannot be started there again.
  folderGone?: boolean;
  agent?: Agent;
};

export const agentOf = (r: RecentConversation): Agent => r.agent ?? 'claude';

export const MACHINE = 'local';
