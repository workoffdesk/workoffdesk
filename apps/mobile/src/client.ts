import { ApiError, createApi } from '@workoffdesk/client/base/api';
import { createAnswers } from '@workoffdesk/client/chat/answered';
import { createChatFeeds } from '@workoffdesk/client/chat/chatFeed';
import { createDrafts } from '@workoffdesk/client/composer/drafts';
import { createJournals } from '@workoffdesk/client/journal/journal';
import { createKeyBar } from '@workoffdesk/client/composer/keyBar';
import { signInTo } from '@workoffdesk/client/base/login';
import { MESSAGE_ID_BYTES, messageId } from '@workoffdesk/client/base/messages';
import { CLOSE_SIGNED_OUT, standardSocket, type KeyValue, type OpenSocket, type Visibility } from '@workoffdesk/client/base/platform';
import { MAC_KEY } from '@workoffdesk/client/sessions/macRecent';
import { createSeen } from '@workoffdesk/client/sessions/seen';
import { createSessions } from '@workoffdesk/client/sessions/session';
import { createSessionLinks } from '@workoffdesk/client/sessions/sessionLink';
import { createReleaseWatch } from '@workoffdesk/client/base/release';
import { createSessionList } from '@workoffdesk/client/sessions/sessionList';
import { createSlowReport, SLOW_PATH } from '@workoffdesk/client/base/slow';
import { createSnippets } from '@workoffdesk/client/composer/snippets';
import { createThemeChoice } from '@workoffdesk/client/settings/choices';
import { createTextSize } from '@workoffdesk/client/settings/textSize';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import { AppState, Platform } from 'react-native';
import { chatStore, forgetChats } from './chatStore';
import { createJournalStore } from './journalStore';
import { createPictures } from './pictures';

// What the shared client needs from the phone: where the server is and the token that signs in to it (in
// the Keychain), a store for what is kept on the device, whether the app is in front, and sockets that
// carry the token.

export type Login = { server: string; token: string; user?: string };

// The account in use, and every account kept on the phone, the one in use among them.
const LOGIN_KEY = 'workoffdesk.login';
const ACCOUNTS_KEY = 'workoffdesk.accounts';
// The address last signed in to, offered again after a logout; not a secret, so not in the Keychain.
const SERVER_KEY = 'workoffdesk.server';

export const storage: KeyValue = {
  getItem: (k) => Storage.getItemSync(k),
  setItem: (k, v) => Storage.setItemSync(k, v),
  removeItem: (k) => void Storage.removeItemSync(k),
};

const loginOf = (v: unknown): Login | null => {
  const l = v as { server?: unknown; token?: unknown; user?: unknown } | null;
  return l && typeof l.server === 'string' && typeof l.token === 'string' ? { server: l.server, token: l.token, user: typeof l.user === 'string' ? l.user : undefined } : null;
};

function kept(key: string): unknown {
  try {
    return JSON.parse(SecureStore.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

// One account is a user on a server; signing in to it again replaces its login.
const sameAccount = (a: Login, b: Login) => a.server === b.server && (a.user ?? '') === (b.user ?? '');

let login = loginOf(kept(LOGIN_KEY));
const keptAccounts = ((kept(ACCOUNTS_KEY) as unknown[] | null) ?? []).map(loginOf).filter((a): a is Login => !!a);
let accounts: Login[] = login && !keptAccounts.some((a) => a.token === login!.token) ? [...keptAccounts.filter((a) => !sameAccount(a, login!)), login] : keptAccounts;
const loginListeners = new Set<() => void>();
const keep = (l: Login | null, list: Login[]) =>
  Promise.all([l ? SecureStore.setItemAsync(LOGIN_KEY, JSON.stringify(l)) : SecureStore.deleteItemAsync(LOGIN_KEY), SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(list))]);
const setLogin = (l: Login | null, list: Login[]) => {
  login = l;
  accounts = list;
  void keep(l, list).catch(() => {});
  for (const f of loginListeners) f();
};
const withAccount = (l: Login) => {
  const at = accounts.findIndex((a) => sameAccount(a, l));
  return at < 0 ? [...accounts, l] : accounts.map((a, i) => (i === at ? l : a));
};

// The server records the device a login came from by its user agent; the settings list names it so.
const USER_AGENT = `WorkOffDesk/${Constants.expoConfig?.version ?? '0'} (iPhone; iOS ${Platform.Version})`;

// The server's release: when it moves on, there is newer JS for this app to fetch.
export const release = createReleaseWatch();

export const { api, wsUrl, signIn } = createApi({
  base: () => login?.server ?? '',
  headers: () => ({ 'user-agent': USER_AGENT, ...(login ? { authorization: `Bearer ${login.token}` } : {}) }),
  onUnauthorized: (sent) => signedOut(sent.get('authorization')?.replace(/^Bearer /, '')),
  onVersion: release.saw,
  onSlow: (slow) => reportSlow(slow),
});
const reportSlow = createSlowReport((slow) => api(SLOW_PATH, { method: 'POST', json: { slow } }));
export const usePicture = createPictures(reportSlow);
// The chat's numbers when its last row stayed under the dock at the end of a scroll (ChatList).
export const reportChatEnd = (numbers: Record<string, number | null>) => void api('/api/chat-end', { method: 'POST', json: { numbers } }).catch(() => {});

export const visibility: Visibility = {
  visible: () => AppState.currentState === 'active',
  onChange: (listener) => {
    const sub = AppState.addEventListener('change', listener);
    return () => sub.remove();
  },
};

type NativeWebSocket = new (url: string, protocols: undefined, options: { headers: Record<string, string> }) => WebSocket;
// A socket refused for a login no longer in use is a line dropped (1006): it opens again with the one in use.
const CLOSE_DROPPED = 1006;
const open: OpenSocket = (path, on) => {
  const by = login?.token;
  const closed = (code: number) => on.close(CLOSE_SIGNED_OUT.includes(code) && by !== login?.token ? CLOSE_DROPPED : code);
  return standardSocket(new (WebSocket as unknown as NativeWebSocket)(wsUrl(path), undefined, { headers: signIn() }), { ...on, close: closed });
};

// A socket says signed out only for the login in use (open, above).
export const sessionList = createSessionList({ open, storage, visibility, onSignedOut: () => signedOut(login?.token), ask: () => api('/api/events/now') });
export const sessionLinks = createSessionLinks({ open, visibility, onSignedOut: () => signedOut(login?.token), onSlow: (slow) => reportSlow(slow) });
export const chatFeeds = createChatFeeds({ api, store: chatStore });
export const seen = createSeen(storage);
export const drafts = createDrafts(storage);
export const keyBar = createKeyBar(storage);
export const textSize = createTextSize(storage);
export const themeChoice = createThemeChoice(storage);
export const snippets = createSnippets(storage);

const newMessageId = () => messageId(getRandomBytes(MESSAGE_ID_BYTES));
// The phone's copy of each session's journal, in a file for the Mac signed in to.
export const journals = createJournals({ api, newId: newMessageId, store: createJournalStore(() => login?.server) });
export const answers = createAnswers(storage, journals);
export const sessions = createSessions({
  api,
  journals,
  links: sessionLinks,
  list: sessionList,
  seen,
  answers,
  readClipboard: () => Clipboard.getStringAsync(),
});

// A login of the account given, asked with its own token.
const askAs = (l: Login) => createApi({ base: () => l.server, headers: () => ({ 'user-agent': USER_AGENT, authorization: `Bearer ${l.token}` }), onUnauthorized: () => {} }).api;

export const auth = {
  current: () => login,
  // Every account kept on the phone, the one in use among them, in the order they were added.
  accounts: () => accounts,
  subscribe(listener: () => void) {
    loginListeners.add(listener);
    return () => void loginListeners.delete(listener);
  },
  lastServer: () => {
    try {
      return storage.getItem(SERVER_KEY) ?? '';
    } catch {
      return '';
    }
  },
  // Signs in to an account, a new one or one kept that is signed in to again, and uses it from then on; the
  // one in use stays kept, and `leaving` runs first, while it is still in use.
  async signIn(server: string, username: string, password: string, leaving?: () => Promise<unknown>) {
    const { api: ask } = createApi({ base: () => server, headers: () => ({ 'user-agent': USER_AGENT }), onUnauthorized: () => {} });
    const token = await signInTo(ask, { username, password }, (token) => keep({ server, token, user: username }, withAccount({ server, token, user: username })).then(() => {}));
    try {
      storage.setItem(SERVER_KEY, server);
    } catch {
      // the address is typed again next time
    }
    await moveTo({ server, token, user: username }, leaving);
  },
  // To another account kept, once its Mac still takes its login; false when it no longer does.
  async switchTo(to: Login, leaving?: () => Promise<unknown>): Promise<boolean> {
    try {
      await askAs(to)('/api/auth/logins');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return false;
      throw e;
    }
    await moveTo(to, leaving);
    return true;
  },
  // An account kept, signed out on its Mac too; the phone forgets it whether or not the Mac heard.
  async remove(gone: Login) {
    if (gone.token === login?.token) return auth.signOut();
    setLogin(login, accounts.filter((a) => a.token !== gone.token));
    await askAs(gone)('/api/auth/logout', { method: 'POST' }).catch(() => {});
  },
  // Signs this token out on the server too; the phone forgets it whether or not the server heard.
  async signOut() {
    const gone = login?.token;
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    signedOut(gone);
  },
};

async function moveTo(to: Login, leaving?: () => Promise<unknown>) {
  if (!login) return setLogin(to, withAccount(to));
  await leaving?.().catch(() => {});
  changeAccount(to, withAccount(to));
}

// The server no longer takes a login, or the user logged out of it. Once it is the one in use, what it showed
// goes with it, and the phone goes on with the next account kept, if there is one; heard again, or after the
// phone has moved on, it is nothing.
function signedOut(gone: string | undefined) {
  if (!login || login.token !== gone) return;
  const rest = accounts.filter((a) => a.token !== gone);
  changeAccount(rest[0] ?? null, rest);
}

// What the account in use showed goes, before the next is in use; what is still watched opens again with it.
function changeAccount(to: Login | null, list: Login[]) {
  forgetAccount();
  setLogin(to, list);
  if (to) sessionList.reopen();
}

function forgetAccount() {
  sessionList.forget();
  chatFeeds.forget();
  forgetChats();
  void journals.forget();
  try {
    storage.removeItem(MAC_KEY);
  } catch {
    // nothing was kept
  }
}
