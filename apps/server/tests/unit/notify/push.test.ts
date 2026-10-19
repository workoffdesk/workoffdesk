import { createDecipheriv, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Apns, type ApnsPost } from '../../../src/notify/apns.js';
import { Pusher } from '../../../src/notify/push.js';
import { threadOf } from '../../../src/notify/seal.js';
import { Store } from '../../../src/system/store.js';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KEY = { teamId: 'TEAM123456', keyId: 'KEY1234567', key: privateKey };
const TOKEN = 'a'.repeat(64);

function openSealed(keyB64: string, sealed: string): unknown {
  const box = Buffer.from(sealed, 'base64');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), box.subarray(0, 12));
  d.setAuthTag(box.subarray(box.length - 16));
  return JSON.parse(Buffer.concat([d.update(box.subarray(12, box.length - 16)), d.final()]).toString('utf8'));
}

type Answer = { status: number; reason?: string };
function fakePost(answer: (host: string) => Answer) {
  return vi.fn<ApnsPost>(async (host) => answer(host));
}

describe('Pusher', () => {
  describe('with the iPhone app', () => {
    const setup = (answer: (host: string) => Answer) => {
      const store = new Store(join(mkdtempSync(join(tmpdir(), 'ts-push-')), 'state.json'));
      store.update((s) => {
        s.apnsDevices = [
          { token: TOKEN, topic: 'com.example.app', words: { waiting: 'Needs you', idle: 'Done' }, createdAt: 1 },
          { token: 'b'.repeat(64), topic: 'com.example.app', words: { waiting: '需要你', idle: '做完了' }, host: 'production', createdAt: 1 },
        ];
      });
      const post = fakePost(answer);
      const pusher = new Pusher(store, { subject: 'mailto:x@example.com', apns: new Apns(KEY, post) });
      return { store, post, pusher };
    };

    it("says what happened in each phone's own words, with the session to open", async () => {
      const { post, pusher } = setup(() => ({ status: 200 }));
      await pusher.notify('abc', 'proj', 'waiting', '');
      const bodies = post.mock.calls.map((c) => JSON.parse(c[3]));
      expect(bodies).toEqual([
        { aps: { alert: { title: 'proj', body: 'Needs you' }, sound: 'default', 'thread-id': 'abc' }, body: { sessionId: 'abc' } },
        { aps: { alert: { title: 'proj', body: '需要你' }, sound: 'default', 'thread-id': 'abc' }, body: { sessionId: 'abc' } },
      ]);
    });

    it('remembers the service a device answered on, and forgets a device that is gone', async () => {
      const { store, pusher } = setup((host) => (host === 'production' ? { status: 400, reason: 'BadDeviceToken' } : { status: 200 }));
      await pusher.notify('abc', 'proj', 'idle', '');
      expect(store.get().apnsDevices.map((d) => [d.token[0], d.host])).toEqual([['a', 'sandbox']]);
    });

    it('stays quiet while the session is on a screen', async () => {
      const { post, pusher } = setup(() => ({ status: 200 }));
      pusher.setVisible('abc', 'c1', true);
      await pusher.notify('abc', 'proj', 'idle', '');
      expect(post).not.toHaveBeenCalled();
    });

    it('announces a plain message to every device, with no session to open', async () => {
      const { post, pusher } = setup(() => ({ status: 200 }));
      await pusher.announce('Heads up', '**Lunch** is `ready`');
      expect(post.mock.calls.map((c) => JSON.parse(c[3]))).toEqual([
        { aps: { alert: { title: 'Heads up', body: 'Lunch is ready' }, sound: 'default', 'thread-id': 'announce' } },
        { aps: { alert: { title: 'Heads up', body: 'Lunch is ready' }, sound: 'default', 'thread-id': 'announce' } },
      ]);
    });

    it('keeps a title to one short line for Apple', async () => {
      const { post, pusher } = setup(() => ({ status: 200 }));
      await pusher.announce(`Heads\n up ${'x'.repeat(200)}`, 'Lunch');
      const title = JSON.parse(post.mock.calls[0][3]).aps.alert.title as string;
      expect(title).toMatch(/^Heads up x+$/);
      expect([...title]).toHaveLength(80);
    });

    it('announces again at once, whatever was sent or is on a screen', async () => {
      const { post, pusher } = setup(() => ({ status: 200 }));
      pusher.setVisible('announce', 'c1', true);
      await pusher.notify('abc', 'proj', 'idle', '');
      await pusher.announce('Same', 'text');
      await pusher.announce('Same', 'text');
      expect(post).toHaveBeenCalledTimes(6);
    });
  });

  describe('with the App Store app, through its relay', () => {
    const relayKey = Buffer.alloc(32, 3).toString('base64');
    const RELAYED = { token: 'e'.repeat(64), topic: 'com.example.store', words: { waiting: 'Needs you', idle: 'Done', hidden: 'New on your Mac' }, relay: { url: 'https://relay.example', key: relayKey }, createdAt: 1 };
    const setup = (o: { key?: typeof KEY & { relayTopic?: string }; relayAnswer?: () => Promise<number> } = {}) => {
      const store = new Store(join(mkdtempSync(join(tmpdir(), 'ts-push-')), 'state.json'));
      store.update((s) => {
        s.apnsDevices = [{ ...RELAYED }];
      });
      const post = fakePost(() => ({ status: 200 }));
      const relayPost = vi.fn(o.relayAnswer ?? (async () => 200));
      const pusher = new Pusher(store, { subject: 'mailto:x@example.com', apns: o.key ? new Apns(o.key, post) : undefined, relayPost });
      return { store, post, relayPost, pusher };
    };
    const sent = (relayPost: ReturnType<typeof setup>['relayPost']) =>
      relayPost.mock.calls.map(([url, body]) => [url, JSON.parse(body as string)] as const);

    it('seals what Claude said for the phone alone, and gives the relay only the words for a sealed one', async () => {
      const { relayPost, pusher } = setup();
      await pusher.notify('abc', 'proj', 'waiting', 'Which one?');
      const [[url, body]] = sent(relayPost);
      expect(url).toBe('https://relay.example/api/push/relay');
      expect(body).toEqual({ token: RELAYED.token, topic: RELAYED.topic, sealed: expect.any(String), thread: threadOf(relayKey, 'abc'), hidden: 'New on your Mac' });
      expect(JSON.stringify(body)).not.toMatch(/proj|Which one|abc|Needs you/);
      expect(openSealed(relayKey, body.sealed)).toEqual({ alert: { title: 'proj', subtitle: 'Needs you', body: 'Which one?' }, sessionId: 'abc' });
    });

    it("goes through the relay though this server has a key, which is for its owner's own app", async () => {
      const { post, relayPost, pusher } = setup({ key: KEY });
      await pusher.notify('abc', 'proj', 'idle', '');
      expect(relayPost).toHaveBeenCalledTimes(1);
      expect(post).not.toHaveBeenCalled();
    });

    it('goes straight to Apple when this server is the relay for that app', async () => {
      const { post, relayPost, pusher } = setup({ key: { ...KEY, relayTopic: RELAYED.topic } });
      await pusher.notify('abc', 'proj', 'idle', '');
      expect(relayPost).not.toHaveBeenCalled();
      expect(JSON.parse(post.mock.calls[0][3])).toEqual({ aps: { alert: { title: 'proj', body: 'Done' }, sound: 'default', 'thread-id': 'abc' }, body: { sessionId: 'abc' } });
    });

    it('seals an announcement for the relay like any other, with the thread it is grouped under', async () => {
      const { relayPost, pusher } = setup();
      await pusher.announce('Heads up', 'Lunch');
      const [[, body]] = sent(relayPost);
      expect(body).toEqual({ token: RELAYED.token, topic: RELAYED.topic, sealed: expect.any(String), thread: threadOf(relayKey, 'announce'), hidden: 'New on your Mac' });
      expect(JSON.stringify(body)).not.toMatch(/Heads up|Lunch/);
      expect(openSealed(relayKey, body.sealed)).toEqual({ alert: { title: 'Heads up', body: 'Lunch' } });
    });

    it('forgets a device the relay says is gone', async () => {
      const { store, pusher } = setup({ relayAnswer: async () => 410 });
      await pusher.notify('abc', 'proj', 'idle', '');
      expect(store.get().apnsDevices).toEqual([]);
    });

    it.each([
      ['an answer that is not 410', async () => 502],
      ['a relay that cannot be reached', async () => Promise.reject(new TypeError('fetch failed'))],
    ])('keeps the device, and says nothing, after %s', async (_name, relayAnswer) => {
      const { store, pusher } = setup({ relayAnswer });
      await expect(pusher.notify('abc', 'proj', 'idle', '')).resolves.toBeUndefined();
      expect(store.get().apnsDevices).toHaveLength(1);
    });
  });

  describe('with web push', () => {
    const setup = () => {
      let t = 1_000_000;
      const store = new Store(join(mkdtempSync(join(tmpdir(), 'ts-push-')), 'state.json'));
      store.update((s) => {
        s.vapid = { publicKey: 'pub', privateKey: 'priv' };
        s.pushSubs = [
          { endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' }, createdAt: 1 },
          { endpoint: 'https://push.example/b', keys: { p256dh: 'p', auth: 'a' }, createdAt: 1 },
        ];
      });
      const send = vi.fn(async (_sub: any, _payload: string, _opts: any) => ({ statusCode: 201 }));
      const pusher = new Pusher(store, { send, now: () => t, subject: 'mailto:x@example.com' });
      return { store, send, pusher, advance: (ms: number) => (t += ms) };
    };

    it('sends to every subscription with a deep link', async () => {
      const { send, pusher } = setup();
      await pusher.notify('abc', 'proj', 'waiting', '');
      expect(send).toHaveBeenCalledTimes(2);
      expect(JSON.parse(send.mock.calls[0][1])).toEqual({ title: 'proj', event: 'waiting', said: '', url: '/m/local/s/abc', tag: 'abc' });
    });

    it('throttles one session to one push per 30 seconds', async () => {
      const { send, pusher, advance } = setup();
      await pusher.notify('abc', 't', 'idle', '');
      advance(29_000);
      await pusher.notify('abc', 't', 'idle', '');
      expect(send).toHaveBeenCalledTimes(2);
      await pusher.notify('other', 't', 'idle', '');
      expect(send).toHaveBeenCalledTimes(4);
      advance(1_001);
      await pusher.notify('abc', 't', 'idle', '');
      expect(send).toHaveBeenCalledTimes(6);
    });

    it('announces to every subscription, again and again, with the page to open', async () => {
      const { send, pusher } = setup();
      pusher.setVisible('announce', 'c1', true);
      await pusher.announce('Heads up', '# Lunch');
      await pusher.announce('Heads up', '# Lunch');
      expect(send).toHaveBeenCalledTimes(4);
      expect(JSON.parse(send.mock.calls[0][1])).toEqual({ title: 'Heads up', body: 'Lunch', said: 'Lunch', url: '/', tag: 'announce' });
    });

    it('puts the announcement in body, which is the field the service worker shows', async () => {
      const { send, pusher } = setup();
      await pusher.announce('Heads up', 'Lunch');
      expect(JSON.parse(send.mock.calls[0][1]).body).toBe('Lunch');
    });

    it('keeps a title to one short line, in every payload', async () => {
      const { send, pusher } = setup();
      await pusher.announce(`Heads\n up ${'x'.repeat(200)}`, 'Lunch');
      const title = JSON.parse(send.mock.calls[0][1]).title as string;
      expect(title).toMatch(/^Heads up x+$/);
      expect([...title]).toHaveLength(80);
    });

    it('announces to no one, and says nothing, when nothing is registered', async () => {
      const { store, send, pusher } = setup();
      store.update((s) => {
        s.pushSubs = [];
      });
      await expect(pusher.announce('Heads up', 'Lunch')).resolves.toBeUndefined();
      expect(send).not.toHaveBeenCalled();
    });

    it('stays quiet while a visible page shows that session', async () => {
      const { send, pusher } = setup();
      pusher.setVisible('abc', 'c1', true);
      await pusher.notify('abc', 't', 'idle', '');
      expect(send).not.toHaveBeenCalled();
      pusher.setVisible('abc', 'c1', false);
      await pusher.notify('abc', 't', 'idle', '');
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('does not start the cooldown with a push throttled away, when nothing was sent', async () => {
      const { send, pusher } = setup();
      pusher.setVisible('abc', 'c1', true);
      await pusher.notify('abc', 't', 'idle', '');
      pusher.setVisible('abc', 'c1', false);
      await pusher.notify('abc', 't', 'idle', '');
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('drops subscriptions the push service reports gone', async () => {
      const { store, send, pusher } = setup();
      send.mockImplementationOnce(async () => {
        throw Object.assign(new Error('gone'), { statusCode: 410 });
      });
      await pusher.notify('abc', 't', 'idle', '');
      expect(store.get().pushSubs.map((s) => s.endpoint)).toEqual(['https://push.example/b']);
    });

    it('keeps subscriptions on transient errors', async () => {
      const { store, send, pusher } = setup();
      send.mockImplementationOnce(async () => {
        throw Object.assign(new Error('boom'), { statusCode: 500 });
      });
      await pusher.notify('abc', 't', 'idle', '');
      expect(store.get().pushSubs).toHaveLength(2);
    });
  });
});
