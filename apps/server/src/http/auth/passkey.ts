import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { Passkey, Store } from '../../system/store.js';

type Purpose = 'register' | 'login';

const CHALLENGE_TTL = 5 * 60_000;
const MAX_CHALLENGES = 100;

export class ChallengeStore {
  private readonly items = new Map<string, { purpose: Purpose; expires: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  add(challenge: string, purpose: Purpose): void {
    this.items.set(challenge, { purpose, expires: this.now() + CHALLENGE_TTL });
    while (this.items.size > MAX_CHALLENGES) this.items.delete(this.items.keys().next().value!);
  }

  // Any presentation burns the challenge, even a mismatched one.
  consume(challenge: string, purpose: Purpose): boolean {
    const item = this.items.get(challenge);
    this.items.delete(challenge);
    return !!item && item.purpose === purpose && item.expires >= this.now();
  }
}

const PUBLIC = { config: { public: true } };

function deviceName(ua: string): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'Device';
}

export function registerPasskeyRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  deps: { store: Store; now?: () => number },
): void {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const challenges = new ChallengeStore(now);
  const expect = (purpose: Purpose) => (c: string) => challenges.consume(c, purpose);

  app.post('/api/auth/passkey/register/options', async (req) => {
    const { rpId } = ctx.guard.siteOf(req);
    const user = store.get().user!;
    const options = await generateRegistrationOptions({
      rpName: 'WorkOffDesk',
      rpID: rpId,
      userName: user.username,
      userID: Uint8Array.from(Buffer.from(user.username)),
      attestationType: 'none',
      excludeCredentials: store.get().passkeys.map((p) => ({
        id: p.id,
        transports: p.transports as AuthenticatorTransport[] | undefined,
      })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    challenges.add(options.challenge, 'register');
    return options;
  });

  app.post<{ Body: { response?: RegistrationResponseJSON; name?: unknown } }>('/api/auth/passkey/register/verify', async (req, reply) => {
    const response = req.body?.response;
    if (!response) return reply.code(400).send({ error: 'registration failed' });
    const { origin, rpId } = ctx.guard.siteOf(req);
    let result;
    try {
      result = await verifyRegistrationResponse({
        response,
        expectedChallenge: expect('register'),
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
      });
    } catch {
      return reply.code(400).send({ error: 'registration failed' });
    }
    if (!result.verified || !result.registrationInfo) return reply.code(400).send({ error: 'registration failed' });
    const { credential } = result.registrationInfo;
    const name =
      typeof req.body?.name === 'string' && req.body.name.trim()
        ? req.body.name.trim().slice(0, 40)
        : deviceName(String(req.headers['user-agent'] ?? ''));
    const passkey: Passkey = {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports,
      name,
      createdAt: now(),
    };
    store.update((s) => {
      s.passkeys = [...s.passkeys.filter((p) => p.id !== passkey.id), passkey];
    });
    return reply.code(201).send({ id: passkey.id, name: passkey.name });
  });

  app.post('/api/auth/passkey/login/options', PUBLIC, async (req, reply) => {
    if (!ctx.guard.originOk(req)) return reply.code(403).send({ error: 'bad origin' });
    const options = await generateAuthenticationOptions({ rpID: ctx.guard.siteOf(req).rpId, userVerification: 'required' });
    challenges.add(options.challenge, 'login');
    return options;
  });

  app.post<{ Body: { response?: AuthenticationResponseJSON } }>('/api/auth/passkey/login/verify', PUBLIC, async (req, reply) => {
    if (!ctx.guard.originOk(req)) return reply.code(403).send({ error: 'bad origin' });
    const response = req.body?.response;
    const passkey = store.get().passkeys.find((p) => p.id === response?.id);
    const fail = () => {
      ctx.audit(req, 'passkey', false);
      return reply.code(401).send({ error: 'passkey not accepted' });
    };
    if (!passkey || !response) return fail();
    const { origin, rpId } = ctx.guard.siteOf(req);
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: expect('login'),
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
        credential: {
          id: passkey.id,
          publicKey: Uint8Array.from(Buffer.from(passkey.publicKey, 'base64url')),
          counter: passkey.counter,
          transports: passkey.transports as AuthenticatorTransport[] | undefined,
        },
      });
    } catch {
      return fail();
    }
    if (!result.verified) return fail();
    store.update((s) => {
      const p = s.passkeys.find((x) => x.id === passkey.id);
      if (p) {
        p.counter = result.authenticationInfo.newCounter;
        p.lastUsedAt = now();
      }
    });
    ctx.audit(req, 'passkey', true);
    ctx.startLogin(req, reply, 'passkey');
    return reply.code(204).send();
  });

  app.get('/api/auth/passkeys', async () =>
    store.get().passkeys.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt ?? null })),
  );

  app.delete<{ Params: { id: string } }>('/api/auth/passkeys/:id', async (req, reply) => {
    if (!store.get().passkeys.some((p) => p.id === req.params.id)) return reply.code(404).send({ error: 'not found' });
    store.update((s) => {
      s.passkeys = s.passkeys.filter((p) => p.id !== req.params.id);
    });
    return reply.code(204).send();
  });
}
