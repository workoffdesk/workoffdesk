import type { FastifyReply, FastifyRequest } from 'fastify';
import { clientIp, clearedCookie, loginHandle } from '../auth/guard.js';
import { Lockout } from '../auth/lockout.js';
import { verifyPassword } from '../auth/password.js';
import { PUBLIC, type RouteModule } from './context.js';

// A fixed hash keeps the wrong-username path as slow as the wrong-password path.
const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

// Signing in with the password, signing out, and the devices signed in.
export const register: RouteModule = (app, ctx) => {
  const { deps, guard, logins, audit, createLogin, startLogin, secure, now, dropRevokedSockets } = ctx;
  const { store } = deps;
  const lockout = new Lockout(now);

  // One check at a time, so lockout counts every attempt before the next one starts.
  let passwordTurn = Promise.resolve();
  const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = passwordTurn.then(fn);
    passwordTurn = run.then(() => undefined, () => undefined);
    return run;
  };

  app.post<{ Body: { username?: unknown; password?: unknown } }>('/api/auth/password', PUBLIC, async (req, reply) => {
    if (!guard.originOk(req)) return reply.code(403).send({ error: 'bad origin' });
    return oneAtATime(() =>
      passwordLogin(req, reply, () => {
        startLogin(req, reply, 'password');
        return reply.code(204).send();
      }),
    );
  });

  // The app's sign-in: the login comes back as a token for it to send in a header. No cookie is set, so
  // there is nothing another site could ride on, and no Origin to check.
  app.post<{ Body: { username?: unknown; password?: unknown } }>('/api/auth/token', PUBLIC, async (req, reply) =>
    oneAtATime(() => passwordLogin(req, reply, () => reply.send({ token: createLogin(req, 'password') }))),
  );

  const passwordLogin = async (
    req: FastifyRequest<{ Body: { username?: unknown; password?: unknown } }>,
    reply: FastifyReply,
    signIn: () => FastifyReply,
  ) => {
    const ip = clientIp(req);
    const lock = lockout.check(ip);
    if (!lock.ok) {
      audit(req, 'password', false);
      return reply.code(429).header('retry-after', String(lock.retryAfterSec)).send({ error: 'locked' });
    }
    const { username, password } = req.body ?? {};
    const user = store.get().user;
    const nameOk = !!user && typeof username === 'string' && username === user.username;
    const pwOk = await verifyPassword(typeof password === 'string' ? password : '', nameOk ? user!.hash : DUMMY_HASH);
    const ok = nameOk && pwOk;
    audit(req, 'password', ok);
    if (!ok) {
      lockout.fail(ip);
      return reply.code(401).send({ error: 'wrong username or password' });
    }
    lockout.succeed(ip);
    return signIn();
  };

  app.post('/api/auth/logout', PUBLIC, async (req, reply) => {
    if (!guard.crossSiteSafe(req)) return reply.code(403).send({ error: 'bad origin' });
    const login = guard.currentLogin(req);
    if (login) logins.revoke(login.loginId);
    dropRevokedSockets();
    return reply.code(204).header('set-cookie', clearedCookie(secure)).send();
  });

  app.get('/api/me', async () => ({ username: store.get().user?.username }));

  app.get(
    '/api/auth/logins',
    async (req) => {
      const current = guard.currentLogin(req)!.loginId;
      return logins.list().map((l) => ({
        handle: loginHandle(l.id),
        createdAt: l.createdAt,
        lastSeen: l.lastSeen,
        ua: l.ua,
        method: l.method,
        current: l.id === current,
      }));
    },
  );

  app.delete<{ Params: { handle: string } }>(
    '/api/auth/logins/:handle',
    async (req, reply) => {
      const target = logins.list().find((l) => loginHandle(l.id) === req.params.handle);
      if (!target) return reply.code(404).send({ error: 'not found' });
      logins.revoke(target.id);
      dropRevokedSockets();
      return reply.code(204).send();
    },
  );
};
