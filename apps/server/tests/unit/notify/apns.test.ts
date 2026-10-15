import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, constants, type Http2Server, type IncomingHttpHeaders, type ServerHttp2Session, type ServerHttp2Stream } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Apns, ApnsConfigError, http2Post, loadApnsKey, type ApnsPost } from '../../../src/notify/apns.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KEY = { teamId: 'TEAM123456', keyId: 'KEY1234567', key: privateKey };
const TOKEN = 'a'.repeat(64);
const device = (host?: 'production' | 'sandbox') => ({ token: TOKEN, topic: 'com.example.app', host });

type Answer = { status: number; reason?: string };
function fakePost(answer: (host: string) => Answer) {
  return vi.fn<ApnsPost>(async (host) => answer(host));
}

const b64 = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString());

describe('Apns', () => {
  it('posts the alert to the device with a bearer token signed by the team key', async () => {
    const post = fakePost(() => ({ status: 200 }));
    const apns = new Apns(KEY, post, () => 1_000_000);
    expect(await apns.send(device('production'), { aps: { alert: { title: 't', body: 'b' } } }, 'abc')).toEqual({ host: 'production', gone: false, sent: true });
    const [host, path, headers, body] = post.mock.calls[0];
    expect([host, path, JSON.parse(body)]).toEqual(['production', `/3/device/${TOKEN}`, { aps: { alert: { title: 't', body: 'b' } } }]);
    expect(headers).toMatchObject({ 'apns-topic': 'com.example.app', 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-collapse-id': 'abc' });
    const [h, c, sig] = headers.authorization.replace(/^bearer /, '').split('.');
    expect(b64(h)).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(b64(c)).toEqual({ iss: 'TEAM123456', iat: 1000 });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('finds a device that has not said which service it uses: production first, then sandbox', async () => {
    const post = fakePost((host) => (host === 'production' ? { status: 400, reason: 'BadDeviceToken' } : { status: 200 }));
    const apns = new Apns(KEY, post);
    expect(await apns.send(device(), {}, 'x')).toEqual({ host: 'sandbox', gone: false, sent: true });
    expect(post.mock.calls.map((c) => c[0])).toEqual(['production', 'sandbox']);
  });

  it.each([
    ['unregistered', undefined, (_: string) => ({ status: 410, reason: 'Unregistered' })],
    ['a bad token on both services', undefined, (_: string) => ({ status: 400, reason: 'BadDeviceToken' })],
    ['a bad token on its own service', 'sandbox' as const, (_: string) => ({ status: 400, reason: 'BadDeviceToken' })],
  ])('drops a device that is gone: %s', async (_name, host, answer) => {
    const post = fakePost(answer);
    expect((await new Apns(KEY, post).send(device(host), {}, 'x')).gone).toBe(true);
  });

  it('keeps a device whose push failed for another reason, and tries only its own service', async () => {
    const post = fakePost(() => ({ status: 500, reason: 'InternalServerError' }));
    expect(await new Apns(KEY, post).send(device('sandbox'), {}, 'x')).toEqual({ host: 'sandbox', gone: false, sent: false });
    expect(post.mock.calls.map((c) => c[0])).toEqual(['sandbox']);
  });

  it('keeps a device when the service cannot be reached', async () => {
    const post = vi.fn<ApnsPost>(async () => {
      throw new Error('ECONNRESET');
    });
    expect(await new Apns(KEY, post).send(device(), {}, 'x')).toMatchObject({ gone: false, sent: false });
  });

  it('signs a new token after 50 minutes, or at once when Apple says it expired', async () => {
    let t = 0;
    let answer: Answer = { status: 200 };
    const post = fakePost(() => answer);
    const apns = new Apns(KEY, post, () => t);
    const bearer = (i: number) => post.mock.calls[i][2].authorization;
    await apns.send(device('production'), {}, 'x');
    t = 49 * 60_000;
    await apns.send(device('production'), {}, 'x');
    expect(bearer(1)).toBe(bearer(0));
    t = 50 * 60_000;
    await apns.send(device('production'), {}, 'x');
    expect(bearer(2)).not.toBe(bearer(1));
    answer = { status: 403, reason: 'ExpiredProviderToken' };
    t += 1000;
    await apns.send(device('production'), {}, 'x');
    answer = { status: 200 };
    await apns.send(device('production'), {}, 'x');
    expect(bearer(4)).not.toBe(bearer(3));
  });
});

describe('loadApnsKey', () => {
  const home = () => mkdtempSync(join(tmpdir(), 'ts-apns-'));
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  it('returns null without apns.json', () => {
    expect(loadApnsKey(home())).toBeNull();
  });

  it('reads the team, the key id and the .p8 file apns.json names', () => {
    const h = home();
    writeFileSync(join(h, 'AuthKey_KEY1234567.p8'), pem);
    writeFileSync(join(h, 'apns.json'), JSON.stringify({ teamId: 'TEAM123456', keyId: 'KEY1234567', keyFile: join(h, 'AuthKey_KEY1234567.p8') }));
    const k = loadApnsKey(h)!;
    expect([k.teamId, k.keyId, k.key.asymmetricKeyType]).toEqual(['TEAM123456', 'KEY1234567', 'ec']);
  });

  it('reads the App Store app it relays for, if it names one', () => {
    const h = home();
    writeFileSync(join(h, 'k.p8'), pem);
    const base = { teamId: 'TEAM123456', keyId: 'KEY1234567', keyFile: join(h, 'k.p8') };
    writeFileSync(join(h, 'apns.json'), JSON.stringify(base));
    expect(loadApnsKey(h)!.relayTopic).toBeUndefined();
    writeFileSync(join(h, 'apns.json'), JSON.stringify({ ...base, relayTopic: 'com.example.store' }));
    expect(loadApnsKey(h)!.relayTopic).toBe('com.example.store');
  });

  it.each<[string, (h: string) => unknown, RegExp]>([
    ['a relay topic that is not a bundle id', (h) => ({ teamId: 'TEAM123456', keyId: 'KEY1234567', keyFile: join(h, 'k.p8'), relayTopic: 'no spaces allowed' }), /"relayTopic" is not a bundle id/],
    ['a relay topic that is not text', (h) => ({ teamId: 'TEAM123456', keyId: 'KEY1234567', keyFile: join(h, 'k.p8'), relayTopic: true }), /"relayTopic" is not a bundle id/],
    ['not JSON', () => 'nope', /not JSON/],
    ['no team', (h) => ({ keyId: 'KEY1234567', keyFile: join(h, 'k.p8') }), /"teamId" is missing/],
    ['an empty team', (h) => ({ teamId: '', keyId: 'KEY1234567', keyFile: join(h, 'k.p8') }), /"teamId" is missing/],
    ['a team that is not text', (h) => ({ teamId: 1234567890, keyId: 'KEY1234567', keyFile: join(h, 'k.p8') }), /"teamId" is missing/],
    ['no key id', (h) => ({ teamId: 'TEAM123456', keyFile: join(h, 'k.p8') }), /"keyId" is missing/],
    ['a key id that is not text', (h) => ({ teamId: 'TEAM123456', keyId: 7, keyFile: join(h, 'k.p8') }), /"keyId" is missing/],
    ['nothing in it', () => null, /"teamId" is missing/],
    ['a key file that is not there', () => ({ teamId: 'TEAM123456', keyId: 'KEY1234567', keyFile: '/nowhere/AuthKey.p8' }), /"keyFile" names no file: \/nowhere\/AuthKey\.p8/],
    ['a key file that is not text', (h) => ({ teamId: 'TEAM123456', keyId: 'KEY1234567', keyFile: [join(h, 'k.p8')] }), /"keyFile" names no file/],
    ['no key file', () => ({ teamId: 'TEAM123456', keyId: 'KEY1234567' }), /"keyFile" names no file: undefined/],
    ['a key file that holds no key', (h) => ({ teamId: 'TEAM123456', keyId: 'KEY1234567', keyFile: join(h, 'notes.txt') }), /"keyFile" is not a \.p8 key: .*notes\.txt/],
  ])('says what is wrong with apns.json: %s', (_name, config, wrong) => {
    const h = home();
    writeFileSync(join(h, 'k.p8'), pem);
    writeFileSync(join(h, 'notes.txt'), 'not a key');
    const c = config(h);
    writeFileSync(join(h, 'apns.json'), typeof c === 'string' ? c : JSON.stringify(c));
    expect(() => loadApnsKey(h)).toThrow(ApnsConfigError);
    expect(() => loadApnsKey(h)).toThrow(new RegExp(`^${join(h, 'apns.json').replace(/[.]/g, '\\.')}: ${wrong.source}`));
  });
});

// The connection to Apple, against a push service of our own on this machine.
describe('http2Post', () => {
  type Seen = { headers: IncomingHttpHeaders; body: string };
  const service = async (answer: (stream: ServerHttp2Stream, seen: Seen) => void) => {
    const server = createServer();
    const seen: Seen[] = [];
    const sessions: ServerHttp2Session[] = [];
    server.on('session', (s) => sessions.push(s));
    server.on('stream', (stream, headers) => {
      let body = '';
      stream.setEncoding('utf8');
      stream.on('data', (c: string) => (body += c));
      stream.on('end', () => {
        const one = { headers, body };
        seen.push(one);
        answer(stream, one);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    servers.push(server);
    return { origin, seen, sessions, server };
  };
  const servers: Http2Server[] = [];
  afterEach(async () => {
    for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
  });
  const reply = (status: number, body?: string) => (stream: ServerHttp2Stream) => {
    stream.respond({ ':status': status });
    stream.end(body);
  };

  it('posts the body with its headers to the path, and gives back the status and the reason Apple gives', async () => {
    const s = await service((stream, seen) => reply(seen.body === 'bad' ? 400 : 200, seen.body === 'bad' ? JSON.stringify({ reason: 'BadDeviceToken' }) : undefined)(stream));
    const post = http2Post({ production: s.origin, sandbox: s.origin });
    expect(await post('production', `/3/device/${TOKEN}`, { 'apns-topic': 'com.example.app', authorization: 'bearer x' }, '{"aps":{}}')).toEqual({ status: 200, reason: undefined });
    expect(await post('production', `/3/device/${TOKEN}`, {}, 'bad')).toEqual({ status: 400, reason: 'BadDeviceToken' });
    expect(s.seen[0].headers).toMatchObject({ ':method': 'POST', ':path': `/3/device/${TOKEN}`, 'apns-topic': 'com.example.app', authorization: 'bearer x' });
    expect(s.seen[0].body).toBe('{"aps":{}}');
  });

  it('gives back no reason when the answer is not one in JSON', async () => {
    const s = await service(reply(500, '<html>oops</html>'));
    expect(await http2Post({ production: s.origin, sandbox: s.origin })('production', '/3/device/x', {}, '{}')).toEqual({ status: 500, reason: undefined });
  });

  it('keeps one connection to each service, and opens another once one is closed', async () => {
    const prod = await service(reply(200));
    const sandbox = await service(reply(200));
    const post = http2Post({ production: prod.origin, sandbox: sandbox.origin });
    await post('production', '/3/device/a', {}, '{}');
    await post('production', '/3/device/b', {}, '{}');
    await post('sandbox', '/3/device/c', {}, '{}');
    expect([prod.seen.length, prod.sessions.length, sandbox.seen.length, sandbox.sessions.length]).toEqual([2, 1, 1, 1]);
    await new Promise<void>((r) => prod.sessions[0].close(r));
    expect(await post('production', '/3/device/d', {}, '{}')).toEqual({ status: 200, reason: undefined });
    expect(prod.sessions).toHaveLength(2);
  });

  it('fails when the service drops the post without an answer', async () => {
    const s = await service((stream) => stream.close(constants.NGHTTP2_CANCEL));
    await expect(http2Post({ production: s.origin, sandbox: s.origin })('production', '/3/device/x', {}, '{}')).rejects.toThrow();
  });

  it('fails when the service cannot be reached, and reaches it once it can', async () => {
    const s = await service(reply(200));
    const origin = s.origin;
    await new Promise((r) => s.server.close(r));
    servers.splice(servers.indexOf(s.server), 1);
    const post = http2Post({ production: origin, sandbox: origin });
    await expect(post('production', '/3/device/x', {}, '{}')).rejects.toThrow();
    const port = Number(new URL(origin).port);
    const again = createServer();
    servers.push(again);
    again.on('stream', (stream) => reply(200)(stream));
    await new Promise<void>((r) => again.listen(port, '127.0.0.1', r));
    expect(await post('production', '/3/device/x', {}, '{}')).toEqual({ status: 200, reason: undefined });
  });
});
