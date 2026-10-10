import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Apns, type ApnsPost } from '../../../src/notify/apns.js';
import { Pusher } from '../../../src/notify/push.js';
import { Store } from '../../../src/system/store.js';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KEY = { teamId: 'TEAM123456', keyId: 'KEY1234567', key: privateKey };
const TOKEN = 'a'.repeat(64);

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
