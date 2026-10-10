import { ApiError, createApi, errorText } from '@workoffdesk/client/base/api';
import type { KeyValue } from '@workoffdesk/client/base/platform';
import { takeSetupToken } from '@workoffdesk/client/mac/setup';
import { t } from '@workoffdesk/i18n';
import type { ReactNode } from 'react';

// What every step of the setup wizard talks to the Mac with, and says when a call fails.

export const MIN_PASSWORD = 12;

const tabStorage: KeyValue = {
  getItem: (k) => sessionStorage.getItem(k),
  setItem: (k, v) => sessionStorage.setItem(k, v),
  removeItem: (k) => sessionStorage.removeItem(k),
};

export const token = takeSetupToken(location.hash, tabStorage);
// Out of the address bar and the history, so it is not shared with a screenshot.
if (location.hash) history.replaceState(null, '', location.pathname);

export const { api } = createApi({
  base: () => location.origin,
  headers: (): Record<string, string> => (token ? { 'x-setup-token': token } : {}),
  onUnauthorized: () => {},
});

export const post = <T,>(path: string, json: object) => api<T>(path, { method: 'POST', json });

// What a failed call says on the page: a wrong token and a wizard that ended each have their own words.
export const callError = (e: unknown) => (e instanceof ApiError && e.status === 403 ? t.setupNoToken : errorText(e, t.failed, t.setupGone));

export function Pending({ busy, children }: { busy: boolean; children: ReactNode }) {
  return busy ? <span className="spinner small" /> : <>{children}</>;
}
