import { t } from '@workoffdesk/i18n';

// Push only: no fetch handler, so nothing is ever served from a stale cache.
const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', () => void sw.skipWaiting());
sw.addEventListener('activate', (e) => e.waitUntil(sw.clients.claim()));

sw.addEventListener('push', (e) => {
  // event: what happened (server/agents/claude/hooks/status.ts's PushEvent), said here in the phone's language.
  // said: what Claude said it was about, as a line (server/push.ts).
  let d: { title?: string; body?: string; event?: string; said?: string; url?: string; tag?: string } = {};
  try {
    d = e.data?.json() ?? {};
  } catch {
    d = { body: e.data?.text() };
  }
  e.waitUntil(
    sw.registration.showNotification(d.title ?? 'WorkOffDesk', {
      body: d.event === 'waiting' || d.event === 'idle' ? bodyOf(d.event, d.said) : d.body,
      tag: d.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: d.url ?? '/' },
    }),
  );
});

// A finished turn's reply says by itself that the turn is over; what Claude asks follows the word that it waits.
const bodyOf = (event: 'waiting' | 'idle', said = '') => (!said ? t.push[event] : event === 'waiting' ? `${t.push.waiting}\n${said}` : said);

sw.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url: string = e.notification.data?.url ?? '/';
  e.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = windows[0];
      if (win) {
        win.postMessage({ type: 'open', url });
        return win.focus();
      }
      return sw.clients.openWindow(url);
    })(),
  );
});
