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

  it('keeps the relay an App Store app names, with its key and the words for a notification it cannot open', async () => {
    const token = 'd'.repeat(64);
    const relay = { url: 'https://relay.example', key: Buffer.alloc(32, 1).toString('base64') };
    const device = { token, topic: 'com.example.app', words: { waiting: 'W', idle: 'I', hidden: 'New on your Mac' }, relay };
    expect((await api('/api/push/apns', { method: 'POST', body: JSON.stringify(device) })).status).toBe(204);
    const newKey = { ...device, relay: { ...relay, key: Buffer.alloc(32, 2).toString('base64') } };
    expect((await api('/api/push/apns', { method: 'POST', body: JSON.stringify(newKey) })).status).toBe(204);
    expect(store.get().apnsDevices.map(({ words, relay: r }) => ({ words, relay: r }))).toEqual([{ words: device.words, relay: newKey.relay }]);
    await api('/api/push/apns', { method: 'DELETE', body: JSON.stringify({ token }) });
  });

  it('is ready for an app with a relay, though this server has no key of its own', async () => {
    expect(await (await api('/api/push/apns')).json()).toEqual({ ready: false });
    expect(await (await api('/api/push/apns?relay=1')).json()).toEqual({ ready: true });
  });

  const w = { waiting: 'w', idle: 'i' };
  it.each([
    ['a token that is not hex', { token: 'zz', topic: 'a.b', words: w }],
    ['no topic', { token: 'c'.repeat(64), words: w }],
    ['no words', { token: 'c'.repeat(64), topic: 'a.b' }],
    ['a relay that is not https', { token: 'c'.repeat(64), topic: 'a.b', words: w, relay: { url: 'http://relay.example', key: Buffer.alloc(32).toString('base64') } }],
    ['a relay with a path', { token: 'c'.repeat(64), topic: 'a.b', words: w, relay: { url: 'https://relay.example/x', key: Buffer.alloc(32).toString('base64') } }],
    ['a relay key that is not 32 bytes', { token: 'c'.repeat(64), topic: 'a.b', words: w, relay: { url: 'https://relay.example', key: Buffer.alloc(16).toString('base64') } }],
    ['a relay but no words for a notification it cannot open', { token: 'c'.repeat(64), topic: 'a.b', words: w, relay: { url: 'https://relay.example', key: Buffer.alloc(32).toString('base64') } }],
    ['words for a hidden notification too long', { token: 'c'.repeat(64), topic: 'a.b', words: { ...w, hidden: 'x'.repeat(121) } }],
  ])('rejects an iPhone app record with %s', async (_name, body) => {
    expect((await api('/api/push/apns', { method: 'POST', body: JSON.stringify(body) })).status).toBe(400);
  });
});
