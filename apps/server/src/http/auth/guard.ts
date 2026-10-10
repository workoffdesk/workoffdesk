import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Login } from '../../system/store.js';
import type { LoginSessions } from './sessions.js';

export const COOKIE = 'wod_session';
const BEARER = /^Bearer (\S+)$/i;
const MAX_AGE_SEC = 30 * 24 * 60 * 60;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function sessionCookie(id: string, secure: boolean): string {
  return [`${COOKIE}=${id}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${MAX_AGE_SEC}`, ...(secure ? ['Secure'] : [])].join('; ');
}

export function clearedCookie(secure: boolean): string {
  return [`${COOKIE}=`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0', ...(secure ? ['Secure'] : [])].join('; ');
}

export function loginHandle(id: string): string {
  return createHash('sha256').update(id).digest('base64url').slice(0, 16);
}

export function clientIp(req: FastifyRequest): string {
  const cf = req.headers['cf-connecting-ip'];
  return (Array.isArray(cf) ? cf[0] : cf) || req.ip;
}

export class Guard {
  constructor(
    private readonly logins: LoginSessions,
    private readonly origin: string,
  ) {}

  originOk(req: FastifyRequest): boolean {
    return req.headers.origin === this.origin;
  }

  // The login a request claims, and whether it came in the cookie. A browser sends the cookie by itself to
  // whatever page makes the request; the Authorization header only the app's own code puts there. Where
  // the header is sent the cookie is not looked at, so a made-up header cannot carry a real cookie past
  // the Origin check.
  private credential(req: FastifyRequest): { id: string; byCookie: boolean } | null {
    const auth = req.headers.authorization;
    if (auth !== undefined) return { id: BEARER.exec(auth)?.[1] ?? '', byCookie: false };
    const id = parseCookies(req.headers.cookie)[COOKIE];
    return id ? { id, byCookie: true } : null;
  }

  // Whether another site could have had a browser make this request: only by riding on the cookie.
  crossSiteSafe(req: FastifyRequest): boolean {
    return this.credential(req)?.byCookie === false || this.originOk(req);
  }

  currentLogin(req: FastifyRequest): (Login & { loginId: string }) | null {
    const c = this.credential(req);
    const login = c?.id ? this.logins.validate(c.id) : null;
    return login ? { ...login, loginId: c!.id } : null;
  }

  // Returns true when the request may proceed; otherwise it has already replied.
  check(req: FastifyRequest, reply: FastifyReply): boolean {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !this.crossSiteSafe(req)) {
      reply.code(403).send({ error: 'bad origin' });
      return false;
    }
    if (!this.currentLogin(req)) {
      reply.code(401).send({ error: 'login required' });
      return false;
    }
    return true;
  }

  // WebSocket handshakes cannot surface an HTTP status to the browser, so the
  // verdict is delivered as a close code after the upgrade completes.
  wsRejectCode(req: FastifyRequest): number | null {
    if (!this.crossSiteSafe(req)) return 4403;
    if (!this.currentLogin(req)) return 4401;
    return null;
  }
}
