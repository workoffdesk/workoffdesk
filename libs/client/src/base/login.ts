import { t } from '@workoffdesk/i18n';
import { ApiError, errorText, type Api } from './api';

// The server let the login in, but the device could not keep its token (iOS's keychain refused).
export class LoginNotKept extends Error {}

// Asks the server for a token and keeps it; a failure to keep it is told apart from one to get it. A token
// that could not be kept is signed out again, as far as the server can be told, so no login is left that
// nothing holds.
export async function signInTo(api: Api, credentials: { username: string; password: string }, keep: (token: string) => Promise<void>): Promise<string> {
  const { token } = await api<{ token: string }>('/api/auth/token', { method: 'POST', json: credentials });
  try {
    await keep(token);
  } catch (e) {
    await api('/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
    throw new LoginNotKept('login not kept', { cause: e });
  }
  return token;
}

// Why signing in failed, in words: only a request that got no answer is the server out of reach.
export function loginErrorText(e: unknown): string {
  if (e instanceof LoginNotKept) return t.loginNotKept;
  if (e instanceof ApiError && e.status === 401) return t.wrongPassword;
  if (e instanceof ApiError && e.status === 429) return t.tooManyTries(Math.ceil((e.retryAfter ?? 900) / 60));
  return errorText(e, e instanceof ApiError ? t.loginFailed(e.status) : t.loginFailedOther);
}
