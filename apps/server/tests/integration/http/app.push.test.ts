import { describe, expect, it } from 'vitest';
import { liveServer } from '../../helpers/server.js';

const live = liveServer('pu', { signedIn: true });
const { store, api } = live;

describe('/api/push', () => {
  it('serves the VAPID public key and stores, dedupes and removes subscriptions', async () => {
    expect(await (await api('/api/push/key')).json()).toEqual({ publicKey: 'BPUBLICKEY' });
    const sub = { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } };
    expect((await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) })).status).toBe(204);
    expect((await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) })).status).toBe(204);
    expect(store.get().pushSubs.filter((s) => s.endpoint === sub.endpoint)).toHaveLength(1);
    const del = await api('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) });
    expect(del.status).toBe(204);
    expect(store.get().pushSubs).toHaveLength(0);
  });

  it('rejects a subscription that is not an https push endpoint', async () => {
    const bad = { endpoint: 'http://127.0.0.1:22/', keys: { p256dh: 'p', auth: 'a' } };
    expect((await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(bad) })).status).toBe(400);
    expect((await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ endpoint: 'https://x' }) })).status).toBe(400);
  });

  it('keeps one record per iPhone app, with its words, and keeps the service it was found on', async () => {
    expect(await (await api('/api/push/apns')).json()).toEqual({ ready: false });
    const token = 'c'.repeat(64);
    const device = { token, topic: 'com.example.app', words: { waiting: 'Needs you', idle: 'Done' } };
    expect((await api('/api/push/apns', { method: 'POST', body: JSON.stringify(device) })).status).toBe(204);
    store.update((s) => {
      s.apnsDevices[0].host = 'sandbox';
    });
    const again = { ...device, words: { waiting: '需要你', idle: '做完了' } };
    expect((await api('/api/push/apns', { method: 'POST', body: JSON.stringify(again) })).status).toBe(204);
    expect(store.get().apnsDevices.map(({ token: t, words, host }) => ({ t, words, host }))).toEqual([{ t: token, words: again.words, host: 'sandbox' }]);
    expect((await api('/api/push/apns', { method: 'DELETE', body: JSON.stringify({ token }) })).status).toBe(204);
    expect(store.get().apnsDevices).toHaveLength(0);
  });

  it.each([
    ['a token that is not hex', { token: 'zz', topic: 'a.b', words: { waiting: 'w', idle: 'i' } }],
    ['no topic', { token: 'c'.repeat(64), words: { waiting: 'w', idle: 'i' } }],
    ['no words', { token: 'c'.repeat(64), topic: 'a.b' }],
  ])('rejects an iPhone app record with %s', async (_name, body) => {
    expect((await api('/api/push/apns', { method: 'POST', body: JSON.stringify(body) })).status).toBe(400);
  });
});
