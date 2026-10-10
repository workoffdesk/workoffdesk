import { t } from '@workoffdesk/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from '../../src/base/api';
import { loginErrorText, signInTo } from '../../src/base/login';

const json = (status: number, body: object, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// Signing in as the login screen does, against a server that answers with `net`, keeping the token with `keep`.
async function said(net: (url: string, init: RequestInit) => Promise<Response>, keep: (token: string) => Promise<void> = async () => {}) {
  vi.stubGlobal('fetch', vi.fn(net));
  const { api } = createApi({ base: () => 'https://mac', onUnauthorized: () => {} });
  const done = signInTo(api, { username: 'u', password: 'p' }, keep).then(
    () => 'signed in',
    (e) => loginErrorText(e),
  );
  await vi.advanceTimersByTimeAsync(60_000);
  return done;
}

describe('signInTo', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps the token the server gave', async () => {
    const keep = vi.fn(async () => {});
    expect(await said(() => Promise.resolve(json(200, { token: 'tok' })), keep)).toBe('signed in');
    expect(keep).toHaveBeenCalledWith('tok');
  });

  it('says the login could not be saved when the server let it in but the phone could not keep it', async () => {
    const keychain = async () => {
      throw Object.assign(new Error("Calling the 'setValueWithKeyAsync' function has failed → Caused by: Keychain error -34018"), { code: 'ERR_KEY_CHAIN' });
    };
    expect(await said(() => Promise.resolve(json(200, { token: 'tok' })), keychain)).toBe(t.loginNotKept);
  });

  // The server's answer to each path, and what was asked of it.
  function server(answers: Record<string, () => Promise<Response>>) {
    const asked: { path: string; authorization: string | null }[] = [];
    const net = vi.fn((url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      asked.push({ path, authorization: new Headers(init.headers).get('authorization') });
      return answers[path]();
    });
    return { net, asked };
  }
  const keychain = async () => {
    throw new Error('Keychain error -34018');
  };

  it('signs out on the server a token it could not keep, so no login is left behind', async () => {
    const s = server({ '/api/auth/token': () => Promise.resolve(json(200, { token: 'tok' })), '/api/auth/logout': () => Promise.resolve(new Response(null, { status: 204 })) });
    expect(await said(s.net as never, keychain)).toBe(t.loginNotKept);
    expect(s.asked.at(-1)).toEqual({ path: '/api/auth/logout', authorization: 'Bearer tok' });
  });

  it.each([
    ['refuses', () => Promise.resolve(json(500, { error: 'no' }))],
    ['never hears', () => Promise.reject(new TypeError('Load failed'))],
  ])('still says the login could not be saved when the server %s the sign-out', async (_, logout) => {
    const s = server({ '/api/auth/token': () => Promise.resolve(json(200, { token: 'tok' })), '/api/auth/logout': logout });
    expect(await said(s.net as never, keychain)).toBe(t.loginNotKept);
    expect(s.asked.some((a) => a.path === '/api/auth/logout')).toBe(true);
  });

  it('signs nothing out when the login was kept', async () => {
    const s = server({ '/api/auth/token': () => Promise.resolve(json(200, { token: 'tok' })) });
    expect(await said(s.net as never)).toBe('signed in');
    expect(s.asked.map((a) => a.path)).toEqual(['/api/auth/token']);
  });

  it('says the server cannot be reached only when it did not answer', async () => {
    expect(await said(() => Promise.reject(new TypeError('fetch failed: UnexpectedException: Could not connect to the server.')))).toBe(t.noServer);
  });

  it('reports a wrong password, and how long to wait after too many tries', async () => {
    expect(await said(() => Promise.resolve(json(401, { error: 'bad' })))).toBe(t.wrongPassword);
    expect(await said(() => Promise.resolve(json(429, { error: 'slow down' }, { 'retry-after': '120' })))).toBe(t.tooManyTries(2));
  });

  it('shows what the server said for another refusal, else the status it failed with', async () => {
    expect(loginErrorText(new ApiError(400, 'Username required'))).toBe('Username required');
    expect(loginErrorText(new ApiError(500, ''))).toBe(t.loginFailed(500));
  });

  it.each([new Error('UnexpectedException: something native'), 'a string', null])('says login failed for anything else (%s), never its text', (e) => {
    expect(loginErrorText(e)).toBe(t.loginFailedOther);
  });
});
