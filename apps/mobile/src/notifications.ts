import { t } from '@workoffdesk/i18n';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { api, auth, storage } from './client';
import { openSessionFromOutside } from './openSession';

// Notifications when Claude needs you or finishes a turn, sent by the server through Apple's push service
// (server/apns.ts). The server says them in the words this phone gave it.

export type NotifyState = 'unready' | 'denied' | 'off' | 'on';

// The server the switch was turned on for; another server has not been told about this phone.
const ON_KEY = 'workoffdesk.notify';

export const onHere = () => {
  try {
    return storage.getItem(ON_KEY) === auth.current()?.server;
  } catch {
    return false;
  }
};

async function serverReady(): Promise<boolean> {
  return api<{ ready: boolean }>('/api/push/apns').then(
    (r) => r.ready,
    () => false,
  );
}

// The token last told, by server: asking iOS for the token also reports it to the push token listener,
// which would otherwise tell the server again, and again.
let told: { server: string; token: string } | null = null;

async function tell(token?: string): Promise<void> {
  const now = token ?? (await Notifications.getDevicePushTokenAsync()).data;
  const server = auth.current()?.server ?? '';
  if (told?.server === server && told.token === now) return;
  const topic = Constants.expoConfig?.ios?.bundleIdentifier ?? '';
  await api('/api/push/apns', { method: 'POST', json: { token: now, topic, words: t.push } });
  told = { server, token: now };
}

export async function notifyState(): Promise<NotifyState> {
  if (!(await serverReady())) return 'unready';
  if ((await Notifications.getPermissionsAsync()).status === 'denied') return 'denied';
  return onHere() ? 'on' : 'off';
}

export async function notifyOn(): Promise<NotifyState> {
  const { granted } = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  if (!granted) return 'denied';
  await tell();
  storage.setItem(ON_KEY, auth.current()?.server ?? '');
  return 'on';
}

export async function notifyOff(): Promise<NotifyState> {
  if (!onHere()) return 'off';
  storage.removeItem(ON_KEY);
  told = null;
  const { data: token } = await Notifications.getDevicePushTokenAsync();
  await api('/api/push/apns', { method: 'DELETE', json: { token } });
  return 'off';
}

// Notifications go with the phone from the account in use to the one `move` leaves it on: off for the one it
// leaves, while that is still in use, and on for the next if they were on.
export async function carryNotifications<T>(move: (leaving: () => Promise<unknown>) => Promise<T>): Promise<T> {
  const on = onHere();
  const from = auth.current()?.token;
  const moved = await move(notifyOff);
  if (on && auth.current() && auth.current()?.token !== from) await notifyOn().catch(() => {});
  return moved;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const sessionOf = (r: Notifications.NotificationResponse | null) => {
  const id = r?.notification.request.content.data?.sessionId;
  return typeof id === 'string' ? id : null;
};

// While signed in: a tapped notification opens its session over the list, and the server hears this phone's token
// again (iOS may hand out a new one) whenever the switch is on. path: the page in front.
export function useNotifications(signedIn: boolean, path: string) {
  const here = useRef(path);
  useLayoutEffect(() => {
    here.current = path;
  });
  useEffect(() => {
    if (!signedIn) return;
    if (onHere()) void tell().catch(() => {});
    const open = (r: Notifications.NotificationResponse | null) => {
      const id = sessionOf(r);
      if (!id) return;
      Notifications.clearLastNotificationResponse();
      openSessionFromOutside({ here: () => here.current, canDismiss: () => router.canDismiss(), dismissAll: () => router.dismissAll(), push: (href) => router.push(href) }, id);
    };
    open(Notifications.getLastNotificationResponse());
    const tapped = Notifications.addNotificationResponseReceivedListener(open);
    const renewed = Notifications.addPushTokenListener(({ data }) => onHere() && void tell(String(data)).catch(() => {}));
    return () => {
      tapped.remove();
      renewed.remove();
    };
  }, [signedIn]);
}
