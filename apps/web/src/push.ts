import { api } from './api';

export type PushState = 'unsupported' | 'insecure' | 'denied' | 'off' | 'on';

export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'open' && typeof e.data.url === 'string') {
        history.pushState(null, '', e.data.url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    });
  }
}

export async function pushState(): Promise<PushState> {
  if (location.protocol !== 'https:') return 'insecure';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function enablePush(): Promise<PushState> {
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const { publicKey } = await api<{ publicKey: string }>('/api/push/key');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api('/api/push/subscribe', { method: 'POST', json: sub.toJSON() });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api('/api/push/subscribe', { method: 'DELETE', json: { endpoint: sub.endpoint } });
    await sub.unsubscribe();
  }
  return 'off';
}
