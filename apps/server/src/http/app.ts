import { appendFileSync } from 'node:fs';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { Guard, clientIp, sessionCookie } from './auth/guard.js';
import { LoginSessions } from './auth/sessions.js';
import { findTranscript, lastSaid } from '../agents/claude/transcript/transcriptFile.js';
import { sites } from '../system/config.js';
import { DomainError, errorReply } from '../system/errors.js';
import { EventHub } from '../sessions/events.js';
import type { LocalMachine } from '../sessions/machine.js';
import type { OpsDeps } from '../ops/report.js';
import type { Pusher } from '../notify/push.js';
import type { Store } from '../system/store.js';
import type { AppContext } from './routes/context.js';
import { register as appUpdate } from './routes/appUpdate.js';
import { register as auth } from './routes/auth.js';
import { register as chat } from './routes/chat.js';
import { register as claude } from './routes/claude.js';
import { register as codex } from './routes/codex.js';
import { register as health } from './routes/health.js';
import { register as journal } from './routes/journal.js';
import { register as mac } from './routes/mac.js';
import { register as media } from './routes/media.js';
import { register as push } from './routes/push.js';
import { register as sessions } from './routes/sessions.js';
import { register as web } from './routes/web.js';
import { VERSION } from '../system/version.js';

export type { AppContext } from './routes/context.js';

export type AppDeps = {
  store: Store;
  machine: LocalMachine;
  origin: string;
  rpId: string;
  extraOrigins?: string[];
  auditPath: string;
  webDir?: string;
  now?: () => number;
  pusher?: Pusher;
  claudeProjectsRoot?: string;
  // Claude Code's background sessions (~/.claude/jobs).
  claudeJobsRoot?: string;
  // Claude Code's own folder (~/.claude), where its skills, commands and plugins are.
  claudeDir?: string;
  // Claude Code itself, asked for the commands its prompt takes.
  claudeBin?: string;
  pinnedDirs?: string[];
  media?: { uploadsDir: string };
  // The iPhone app's JS update this build carries, the file that says when this release became current,
  // and where the bundles offered so far are kept to patch from.
  appUpdate?: { dir: string; activatedFile?: string; bundlesDir?: string };
  // The This Mac page's report and operations; without them it has none.
  ops?: OpsDeps;
  // Without one nothing is logged.
  logger?: FastifyBaseLogger;
  extend?: (app: FastifyInstance, ctx: AppContext) => void | Promise<void>;
};

const CSP = [
  "default-src 'self'",
  "connect-src 'self' wss: ws:",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const { store, machine, origin } = deps;
  const now = deps.now ?? Date.now;
  const app = Fastify({
    trustProxy: false,
    bodyLimit: 64 * 1024,
    loggerInstance: deps.logger,
    logController: new LogController({ disableRequestLogging: true }),
  });
  app.setErrorHandler((e, req, reply) => {
    // fastify's own errors (a body that is not JSON, or too large) carry a status below 500.
    const own = e as { statusCode?: number; message?: string };
    if (!(e instanceof DomainError) && own.statusCode && own.statusCode < 500) return reply.code(own.statusCode).send({ error: own.message });
    const { status, body } = errorReply(e);
    if (status >= 500) req.log.error({ err: e }, 'request failed');
    return reply.code(status).send(body);
  });
  const logins = new LoginSessions(store, now);
  const guard = new Guard(logins, sites({ origin, rpId: deps.rpId, extraOrigins: deps.extraOrigins ?? [] }));
  const secure = origin.startsWith('https://');
  const hub = new EventHub(machine, async (s) => {
    if (s.kind === 'codex') return { reply: machine.lastReply(s.id), at: null };
    const path = s.claudeSessionId && deps.claudeProjectsRoot ? await findTranscript(deps.claudeProjectsRoot, s.claudeSessionId) : null;
    return path ? lastSaid(path) : { reply: null, at: null };
  });

  const audit: AppContext['audit'] = (req, method, ok) => {
    const line = { t: new Date(now()).toISOString(), ip: clientIp(req), ua: req.headers['user-agent'] ?? '', method, ok };
    appendFileSync(deps.auditPath, `${JSON.stringify(line)}\n`, { mode: 0o600 });
  };
  const createLogin: AppContext['createLogin'] = (req, method) => logins.create(String(req.headers['user-agent'] ?? ''), method);
  const startLogin: AppContext['startLogin'] = (req, reply, method) => {
    reply.header('set-cookie', sessionCookie(createLogin(req, method), secure));
  };

  // An open socket lives only as long as the login it was opened with.
  const sockets = new Map<WebSocket, string>();
  const dropRevokedSockets = () => {
    for (const [socket, loginId] of sockets) if (!logins.validate(loginId)) socket.close(4401, 'login ended');
  };
  const sweep = setInterval(dropRevokedSockets, 2000);
  const admit = (socket: WebSocket, req: FastifyRequest): boolean => {
    const code = guard.wsRejectCode(req);
    if (code) {
      socket.close(code);
      return false;
    }
    sockets.set(socket, guard.currentLogin(req)!.loginId);
    socket.on('close', () => sockets.delete(socket));
    return true;
  };

  await app.register(fastifyWebsocket, {
    options: { maxPayload: 1 << 20 },
    // On shutdown every socket is told 4012, "restarting", so the phone comes back soon instead of
    // taking it for a dropped line. Not the standard 1012: Safari reports that one as 1005.
    preClose: (done) => {
      for (const socket of app.websocketServer.clients) socket.close(4012, 'restarting');
      app.websocketServer.close(done);
    },
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('content-security-policy', CSP);
    reply.header('x-frame-options', 'DENY');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-workoffdesk-version', VERSION);
    if (req.routeOptions.url?.startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });

  // Only what someone would look for: a request that failed or took long, and every write, whose arrival is
  // logged too, so one that never answers still shows. The route, not the URL, so nothing in a query string
  // reaches the log.
  app.addHook('onRequest', async (req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') req.log.info({ method: req.method, url: req.routeOptions.url ?? '(no route)' }, 'write arrived');
  });
  app.addHook('onResponse', async (req, reply) => {
    const ms = Math.round(reply.elapsedTime);
    if (reply.statusCode < 400 && ms <= 1000 && (req.method === 'GET' || req.method === 'HEAD')) return;
    req.log.info({ method: req.method, url: req.routeOptions.url ?? '(no route)', status: reply.statusCode, ms }, 'request');
  });

  app.addHook('onClose', async () => {
    clearInterval(sweep);
    hub.close();
  });

  // Every matched route requires a login unless it opts out with `config: { public: true }`.
  // The decision reads the matched route, never the raw URL, which the router decodes first,
  // and comes before the body is read. WebSocket routes answer with close codes instead (see Guard.wsRejectCode).
  app.addHook('onRequest', async (req, reply) => {
    if (req.ws || req.is404 || (req.routeOptions.config as { public?: boolean }).public) return;
    if (!guard.check(req, reply)) return reply;
  });

  const machineOr404 = (req: FastifyRequest<{ Params: { machine: string } }>, reply: FastifyReply) => {
    if (req.params.machine === machine.id) return machine;
    reply.code(404).send({ error: 'unknown machine' });
    return null;
  };

  const ctx: AppContext = { deps, guard, logins, hub, secure, now, audit, createLogin, startLogin, admit, dropRevokedSockets, machineOr404 };

  for (const register of [health, auth, sessions, chat, journal, media, claude, codex, push, appUpdate, mac]) await register(app, ctx);

  if (deps.extend) await deps.extend(app, ctx);

  await web(app, ctx);

  return { app, ctx };
}
