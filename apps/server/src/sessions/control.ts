import { request, createServer, type Server, type ServerResponse } from 'node:http';
import type { AccountsView } from '../agents/claude/accounts.js';
import { listenOwnerOnly } from '../agents/claude/hooks/hooks.js';
import { errorReply } from '../system/errors.js';

// What a terminal on this Mac asks the running server for: a Claude or Codex session opened here, which the
// phone then has like any other. A Claude gets the terminal's environment; Codex runs its commands in the app
// server its sessions share.
export type OpenRequest = { kind?: 'claude' | 'codex'; cwd: string; resumeId?: string; env?: Record<string, string> };

// The Claude accounts, as the This Mac page has them: for the CLI, and the menu bar app through it.
export type ControlAccounts = {
  view(): Promise<AccountsView>;
  pick(id: string): Promise<AccountsView>;
  move(): Promise<AccountsView>;
};

// How many sessions are working, for the menu bar app: asked again on each change and every recheckMs, which
// catches a change nobody was told of.
export type ControlActivity = {
  working(): number;
  onChange(cb: () => void): () => void;
  recheckMs?: number;
};

// An environment's whole size is bounded by what exec takes on macOS, 1 MiB.
const MAX_BODY = 1024 * 1024;

const isEnv = (x: unknown): x is Record<string, string> =>
  typeof x === 'object' && x !== null && !Array.isArray(x) && Object.values(x).every((v) => typeof v === 'string');

type Reply = { status: number; body: object };
const bad = (error: string): Reply => ({ status: 400, body: { error } });

function openSession(open: (r: OpenRequest) => Promise<string>, body: unknown): Reply | Promise<Reply> {
  const r = body as OpenRequest | undefined;
  if (typeof r?.cwd !== 'string' || (r.resumeId !== undefined && typeof r.resumeId !== 'string')) return bad('cwd required');
  if (r.env !== undefined && !isEnv(r.env)) return bad('env must be names to strings');
  if (r.kind !== undefined && r.kind !== 'claude' && r.kind !== 'codex') return bad('kind must be claude or codex');
  return open({ kind: r.kind, cwd: r.cwd, resumeId: r.resumeId, env: r.env }).then(
    (id) => ({ status: 201, body: { id } }),
    (e: unknown) => ({ status: 400, body: { error: e instanceof Error ? e.message : String(e) } }),
  );
}

// The working count as a line of JSON at once, then again each time it changes, until the client goes away.
function streamActivity(activity: ControlActivity, res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  let last = -1;
  const check = () => {
    const working = activity.working();
    if (working === last) return;
    last = working;
    res.write(`${JSON.stringify({ working })}\n`);
  };
  check();
  const unwatch = activity.onChange(check);
  const timer = setInterval(check, activity.recheckMs ?? 2000).unref();
  res.on('close', () => {
    unwatch();
    clearInterval(timer);
  });
}

export function startControlServer(
  sockPath: string,
  o: { open: (r: OpenRequest) => Promise<string>; accounts: ControlAccounts; activity: ControlActivity },
): Promise<Server> {
  const answered = (view: Promise<AccountsView>): Promise<Reply> =>
    view.then(
      (body) => ({ status: 200, body }),
      (e: unknown) => {
        const r = errorReply(e);
        if (r.status === 500) console.error(`workoffdesk: the control socket could not answer: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
        return r;
      },
    );
  const routes: Record<string, (body: unknown) => Reply | Promise<Reply>> = {
    'POST /sessions': (r) => openSession(o.open, r),
    'GET /accounts': () => answered(o.accounts.view()),
    'PUT /account': (r) => {
      const id = (r as { id?: unknown } | undefined)?.id;
      return typeof id === 'string' ? answered(o.accounts.pick(id)) : bad('bad id');
    },
    'POST /account/move': () => answered(o.accounts.move()),
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      const reply = ({ status, body }: Reply) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET' && req.url === '/activity') return streamActivity(o.activity, res);
      const route = routes[`${req.method} ${req.url}`];
      if (!route) return reply({ status: 404, body: { error: 'not found' } });
      let body: unknown;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        body = text ? JSON.parse(text) : undefined;
      } catch {
        return reply(bad('bad json'));
      }
      void Promise.resolve(route(body)).then(reply);
    });
  });
  return listenOwnerOnly(server, sockPath);
}

// What the server answered, or why it did not: its message, with its code when it gave one.
function ask<T>(sockPath: string, method: string, path: string, body?: object): Promise<T> {
  return new Promise((done, fail) => {
    const req = request({ socketPath: sockPath, method, path, headers: { 'content-type': 'application/json' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        let answer: { error?: string; code?: string } = {};
        try {
          answer = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          // reported below
        }
        if (res.statusCode! >= 200 && res.statusCode! < 300) return done(answer as T);
        fail(Object.assign(new Error(answer.error ?? `server answered ${res.statusCode}`), answer.code ? { code: answer.code } : {}));
      });
    });
    req.on('error', fail);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

// The id of the session the server opened, or the reason it did not.
export async function askToOpen(sockPath: string, r: OpenRequest): Promise<string> {
  const { id } = await ask<{ id?: string }>(sockPath, 'POST', '/sessions', r);
  if (!id) throw new Error('server answered no session');
  return id;
}

export const askAccounts = (sockPath: string) => ask<AccountsView>(sockPath, 'GET', '/accounts');
export const askToPick = (sockPath: string, id: string) => ask<AccountsView>(sockPath, 'PUT', '/account', { id });
export const askToMove = (sockPath: string) => ask<AccountsView>(sockPath, 'POST', '/account/move');

// Each working count the server sends, until stop() or the server ends the stream; done fails when no server
// answers.
const readCount = (line: string): number | undefined => {
  try {
    const working = (JSON.parse(line) as { working?: unknown }).working;
    return typeof working === 'number' ? working : undefined;
  } catch {
    return undefined;
  }
};

export function watchActivity(sockPath: string, onCount: (working: number) => void): { done: Promise<void>; stop(): void } {
  let stopped = false;
  let req: ReturnType<typeof request> | undefined;
  const done = new Promise<void>((resolve, reject) => {
    req = request({ socketPath: sockPath, method: 'GET', path: '/activity' }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`server answered ${res.statusCode}`));
      }
      let rest = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        const lines = (rest + chunk).split('\n');
        rest = lines.pop()!;
        for (const line of lines) {
          const working = readCount(line);
          if (working !== undefined) onCount(working);
        }
      });
      res.on('close', () => resolve());
    });
    req.on('error', (e) => (stopped ? resolve() : reject(e)));
    req.end();
  });
  return {
    done,
    stop: () => {
      stopped = true;
      req?.destroy();
    },
  };
}
