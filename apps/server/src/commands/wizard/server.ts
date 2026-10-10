import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { hashPassword, MIN_PASSWORD } from '../../http/auth/password.js';
import { ConfigError, DEFAULT_PORT, loadConfig, parseConfig, writeConfig, type Config } from '../../system/config.js';
import type { Check } from '../../ops/doctor.js';
import { Conflict, DomainError, errorReply, InvalidRequest } from '../../system/errors.js';
import { m } from '../../system/messages.js';
import { originQrSvg } from '../qr.js';
import { Store } from '../../system/store.js';

// The first install in a browser (workoffdesk setup --web): checks, account, address, service. A server of
// its own on loopback, short-lived, with no user to sign in as, so a token it printed guards it instead.

export type Remote = {
  tailscale: { dnsName: string; running: boolean } | null;
  cloudflared: { tunnels: string[] } | null;
};

export type WizardDeps = {
  home: string;
  webDir: string;
  token: string;
  // The Host the browser must send, 127.0.0.1:<port>, known once it listens.
  host: () => string;
  doctor: () => Promise<Check[]>;
  // What there is on this Mac to reach it from the phone.
  probe: () => Promise<Remote>;
  run: (cmd: string, args: string[]) => Promise<{ code: number; out: string }>;
  // What install writes, then the service started and waited for; tunnel: the Cloudflare tunnel to run too.
  install: (o: { tunnel?: string }) => Promise<{ ok: boolean; message: string }>;
  onDone: () => void;
  // Each request, for the wizard to end once nobody has used it for a while.
  touch?: () => void;
};

const sameToken = (given: unknown, token: string) => {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

// The config as it is, even one that no longer parses, so what it holds besides the address is kept.
function configThere(home: string): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function configFor(home: string, origin: string): Config {
  const there = configThere(home);
  try {
    // Passkeys belong to the rpId, so it is kept unless the site moves to another address.
    return parseConfig({ ...there, origin, rpId: there.origin === origin ? there.rpId : undefined });
  } catch (e) {
    if (e instanceof ConfigError) throw new InvalidRequest(e.message);
    throw e;
  }
}

function configNow(home: string): Config | null {
  try {
    return loadConfig(home);
  } catch {
    return null;
  }
}

type AddressBody =
  | { kind: 'tailscale' }
  | { kind: 'cloudflare'; tunnel?: unknown; hostname?: unknown }
  | { kind: 'other'; origin?: unknown };

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export async function buildWizard(d: WizardDeps): Promise<FastifyInstance> {
  const app = Fastify({ trustProxy: false, bodyLimit: 16 * 1024 });
  const store = new Store(join(d.home, 'state.json'));
  // The tunnel the address step chose, for the service step to run; another address forgets it.
  let tunnel: string | undefined;

  app.setErrorHandler((e, _req, reply) => {
    const own = e as { statusCode?: number; message?: string };
    if (!(e instanceof DomainError) && own.statusCode && own.statusCode < 500) return reply.code(own.statusCode).send({ error: own.message });
    const { status, body } = errorReply(e);
    return reply.code(status).send(body);
  });

  app.addHook('onRequest', async (req, reply) => {
    d.touch?.();
    const host = d.host();
    // Another site's page can reach this port by a name of its own that resolves here (DNS rebinding), but
    // its requests carry that name.
    if (req.headers.host !== host) return reply.code(403).send({ error: 'forbidden' });
    if (!req.url.startsWith('/api/')) return;
    if (!sameToken(req.headers['x-setup-token'], d.token)) return reply.code(403).send({ error: 'forbidden' });
    if (req.method !== 'GET' && req.headers.origin !== `http://${host}`) return reply.code(403).send({ error: 'forbidden' });
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    reply.header('x-frame-options', 'DENY');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cache-control', req.url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store');
    return payload;
  });

  app.get('/api/setup/state', async () => {
    const config = configNow(d.home);
    const [checks, remote] = await Promise.all([d.doctor(), d.probe()]);
    const user = store.get().user;
    return {
      checks,
      user: user ? user.username : null,
      origin: config?.origin ?? null,
      port: config?.port ?? DEFAULT_PORT,
      qr: config ? originQrSvg(config.origin) || null : null,
      remote,
    };
  });

  app.post<{ Body: { username?: unknown; password?: unknown } }>('/api/setup/account', async (req) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username) throw new InvalidRequest(m.cli.emptyUsername);
    if ([...password].length < MIN_PASSWORD) throw new InvalidRequest(m.cli.passwordTooShort(MIN_PASSWORD));
    const hash = await hashPassword(password);
    // As setup does: a new user signs every device out.
    store.update((s) => {
      s.user = { username, hash };
      s.logins = [];
    });
    return { username };
  });

  app.post<{ Body: AddressBody }>('/api/setup/address', async (req) => {
    const body = req.body ?? ({} as AddressBody);
    let config: Config;
    let chosen: string | undefined;
    if (body.kind === 'tailscale') {
      const tailscale = (await d.probe()).tailscale;
      if (!tailscale?.running) throw new Conflict(m.wizard.noTailscale, 'no_tailscale');
      config = configFor(d.home, `https://${tailscale.dnsName}`);
      const r = await d.run('tailscale', ['serve', '--bg', String(config.port)]);
      if (r.code !== 0) throw new DomainError(502, m.wizard.tailscaleFailed(r.out.trim()));
    } else if (body.kind === 'cloudflare') {
      const tunnels = (await d.probe()).cloudflared?.tunnels ?? [];
      if (typeof body.tunnel !== 'string' || !tunnels.includes(body.tunnel)) throw new InvalidRequest(m.wizard.noTunnel(String(body.tunnel)));
      if (typeof body.hostname !== 'string' || !HOSTNAME.test(body.hostname)) throw new InvalidRequest(m.wizard.badHostname);
      config = configFor(d.home, `https://${body.hostname.toLowerCase()}`);
      chosen = body.tunnel;
    } else if (body.kind === 'other') {
      if (typeof body.origin !== 'string') throw new InvalidRequest(m.config.origin);
      config = configFor(d.home, body.origin.trim().replace(/\/+$/, ''));
    } else {
      throw new InvalidRequest('kind: tailscale, cloudflare or other');
    }
    writeConfig(d.home, config);
    tunnel = chosen;
    return { origin: config.origin };
  });

  app.post('/api/setup/service', async () => {
    if (!store.get().user || !configNow(d.home)) throw new Conflict(m.wizard.notReady, 'not_ready');
    return d.install(tunnel ? { tunnel } : {});
  });

  app.post('/api/setup/done', async () => {
    d.onDone();
    return {};
  });

  // The web app's build, its index.html for /setup; nothing else of the app is reachable without its server.
  if (existsSync(join(d.webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: d.webDir, index: false, wildcard: false });
    app.get('/setup', (_req, reply) => reply.type('text/html; charset=utf-8').sendFile('index.html'));
  }
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not found' }));
  return app;
}
