import { reloadAppAsync } from 'expo';
import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { auth, release, storage, type Login } from './client';

// The app runs the JS of the server it is signed in to (for its native runtime): it asks that server for
// an update on starting, every so often, and as soon as an answer names a newer release of the server, and
// downloads it in the background without a word. The newest one starts on the next cold start, on coming back
// after a while away, or from Settings, where it is offered, as iOS offers its own updates. Signed out, the next
// start runs the app's own JS again.

const CHECK_EVERY_MS = 15 * 60_000;
// A check or download that failed (a bad line, a deploy mid-download) is tried again after these waits.
const RETRY_MS = [30_000, 2 * 60_000, 5 * 60_000];
const RELOAD_AFTER_AWAY_MS = 60_000;
// The app reopening itself comes back to the page it was on; a start later than this is not that reopening.
const PLACE_KEY = 'updatePlace';
const PLACE_FRESH_MS = 30_000;

// Only where the transport keeps others from swapping the JS: https, or this phone's own loopback.
const SAFE_SERVER = /^(?:https:\/\/|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$))/i;

export const updateUrlOf = (login: Login | null): string | null =>
  login && SAFE_SERVER.test(login.server) ? `${login.server.replace(/\/+$/, '')}/api/app-update/manifest` : null;

let here: string | null = null;
// The page on screen, for the update to come back to.
export const onPage = (path: string) => {
  here = path;
};

// Starts the JS again on the page on screen: a downloaded update, or the words of a newly chosen language.
export function reopenHere(): void {
  if (here) storage.setItem(PLACE_KEY, JSON.stringify({ path: here, at: Date.now() }));
  // A development build has no update to reload with, and its Updates.reloadAsync does nothing: it reloads
  // from its bundler instead.
  if (__DEV__) void reloadAppAsync();
  else Updates.reloadAsync().catch(() => storage.removeItem(PLACE_KEY));
}

// The page the app was on when it reopened itself; once.
export function pageBeforeReopen(): string | null {
  const raw = storage.getItem(PLACE_KEY);
  if (raw === null) return null;
  storage.removeItem(PLACE_KEY);
  try {
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown };
    return typeof path === 'string' && typeof at === 'number' && Date.now() - at < PLACE_FRESH_MS ? path : null;
  } catch {
    return null;
  }
}

// A newer JS is downloaded and waiting to start.
export const useUpdateReady = (): boolean => Updates.useUpdates().isUpdatePending;

// Checks for updates and starts the one downloaded on coming back after a while away.
export function useAppUpdates(): void {
  const { isUpdatePending } = Updates.useUpdates();
  const pending = useRef(isUpdatePending);
  useEffect(() => {
    pending.current = isUpdatePending;
  }, [isUpdatePending]);

  useEffect(() => {
    if (!Updates.isEnabled) return;
    let url: string | null | undefined;
    let lastCheck = 0;
    let awaySince: number | null = null;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const check = () => {
      clearTimeout(retry);
      lastCheck = Date.now();
      Updates.checkForUpdateAsync()
        .then((r) => (r.isAvailable ? Updates.fetchUpdateAsync() : undefined))
        .then(
          () => (failures = 0),
          () => {
            if (url && failures < RETRY_MS.length) retry = setTimeout(check, RETRY_MS[failures++]);
          },
        );
    };
    const follow = () => {
      const next = updateUrlOf(auth.current());
      if (next === url) return;
      url = next;
      failures = 0;
      clearTimeout(retry);
      try {
        Updates.setUpdateURLAndRequestHeadersOverride(next ? { updateUrl: next, requestHeaders: {} } : null);
      } catch {
        url = null;
        return;
      }
      if (next) check();
    };

    follow();
    const unsubscribe = auth.subscribe(follow);
    const leave = release.subscribe(() => url && check());
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        awaySince ??= Date.now();
        return;
      }
      const away = awaySince === null ? 0 : Date.now() - awaySince;
      awaySince = null;
      if (pending.current && away >= RELOAD_AFTER_AWAY_MS) {
        reopenHere();
      } else if (url && Date.now() - lastCheck >= CHECK_EVERY_MS) {
        check();
      }
    });
    return () => {
      clearTimeout(retry);
      unsubscribe();
      leave();
      sub.remove();
    };
  }, []);
}
