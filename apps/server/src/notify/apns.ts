import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { connect, type ClientHttp2Session } from 'node:http2';
import { join } from 'node:path';

// Notifications to the iPhone app go through Apple's push service, signed with a token key (.p8) of the
// team that signs the app. <home>/apns.json names it: { "teamId", "keyId", "keyFile" }.

export type ApnsKey = { teamId: string; keyId: string; key: KeyObject };
export type ApnsHost = 'production' | 'sandbox';
export type ApnsDevice = { token: string; topic: string; host?: ApnsHost };
export type ApnsPost = (host: ApnsHost, path: string, headers: Record<string, string>, body: string) => Promise<{ status: number; reason?: string }>;

// Apple refuses a token older than an hour, and one renewed more often than every 20 minutes.
const TOKEN_LIFE = 50 * 60_000;
const ORIGINS: Record<ApnsHost, string> = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };

export class ApnsConfigError extends Error {}

export function loadApnsKey(home: string): ApnsKey | null {
  const file = join(home, 'apns.json');
  if (!existsSync(file)) return null;
  const wrong = (what: string) => new ApnsConfigError(`${file}: ${what}`);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw wrong('not JSON');
  }
  const { teamId, keyId, keyFile } = raw ?? {};
  if (typeof teamId !== 'string' || !teamId) throw wrong('"teamId" is missing (the Team ID in the Apple Developer account)');
  if (typeof keyId !== 'string' || !keyId) throw wrong('"keyId" is missing (the 10 characters in AuthKey_<keyId>.p8)');
  if (typeof keyFile !== 'string' || !existsSync(keyFile)) throw wrong(`"keyFile" names no file: ${String(keyFile)}`);
  try {
    return { teamId, keyId, key: createPrivateKey(readFileSync(keyFile)) };
  } catch {
    throw wrong(`"keyFile" is not a .p8 key: ${keyFile}`);
  }
}

export class Apns {
  private token: { value: string; at: number } | null = null;

  constructor(
    private readonly key: ApnsKey,
    private readonly post: ApnsPost = http2Post(),
    private readonly now: () => number = Date.now,
  ) {}

  // A device that has not answered yet is tried on the production service (TestFlight and the App Store),
  // then on the sandbox (builds from Xcode). host: the service it answered on.
  async send(device: ApnsDevice, payload: object, collapseId: string): Promise<{ host?: ApnsHost; gone: boolean }> {
    const hosts: ApnsHost[] = device.host ? [device.host] : ['production', 'sandbox'];
    const body = JSON.stringify(payload);
    for (const host of hosts) {
      const headers = {
        authorization: `bearer ${this.bearer()}`,
        'apns-topic': device.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(this.now() / 1000) + 300),
        'apns-collapse-id': collapseId,
      };
      let res: { status: number; reason?: string };
      try {
        res = await this.post(host, `/3/device/${device.token}`, headers, body);
      } catch {
        return { host: device.host, gone: false };
      }
      if (res.status === 200) return { host, gone: false };
      if (res.status === 410) return { host, gone: true };
      if (res.status === 403 && /ProviderToken/.test(res.reason ?? '')) this.token = null;
      if (res.reason !== 'BadDeviceToken') return { host: device.host ?? host, gone: false };
    }
    return { gone: true };
  }

  private bearer(): string {
    const t = this.now();
    if (this.token && t - this.token.at < TOKEN_LIFE) return this.token.value;
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${part({ alg: 'ES256', kid: this.key.keyId })}.${part({ iss: this.key.teamId, iat: Math.floor(t / 1000) })}`;
    const sig = sign('sha256', Buffer.from(unsigned), { key: this.key.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    this.token = { value: `${unsigned}.${sig}`, at: t };
    return this.token.value;
  }
}

export function http2Post(origins: Record<ApnsHost, string> = ORIGINS): ApnsPost {
  const sessions = new Map<ApnsHost, ClientHttp2Session>();
  const session = (host: ApnsHost) => {
    const open = sessions.get(host);
    if (open && !open.closed && !open.destroyed) return open;
    const s = connect(origins[host]);
    s.on('error', () => s.destroy());
    s.on('close', () => sessions.get(host) === s && sessions.delete(host));
    s.setTimeout(10 * 60_000, () => s.close());
    s.unref();
    sessions.set(host, s);
    return s;
  };
  return (host, path, headers, body) =>
    new Promise((resolve, reject) => {
      const req = session(host).request({ ':method': 'POST', ':path': path, ...headers });
      let status = 0;
      let data = '';
      req.setTimeout(15_000, () => req.close());
      req.on('response', (h) => (status = Number(h[':status'])));
      req.setEncoding('utf8');
      req.on('data', (c: string) => (data += c));
      req.on('error', reject);
      req.on('close', () => {
        if (!status) return reject(new Error('no answer from APNs'));
        let reason: string | undefined;
        try {
          reason = data ? (JSON.parse(data) as { reason?: string }).reason : undefined;
        } catch {
          reason = undefined;
        }
        resolve({ status, reason });
      });
      req.end(body);
    });
}
