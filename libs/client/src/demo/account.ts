import { DEMO_SERVER } from './demoMac';

// An account the app keeps: a user on a server and the token that signs in to it. The demo is one, on a Mac only
// the app simulates (demoMac.ts).
export type Login = { server: string; token: string; user?: string };
export const DEMO_LOGIN: Login = { server: DEMO_SERVER, token: 'demo' };
export const isDemo = (l: Login | null) => l?.server === DEMO_SERVER;

// One account is a user on a server; signing in to it again replaces its login.
export const sameAccount = (a: Login, b: Login) => a.server === b.server && (a.user ?? '') === (b.user ?? '');

// The accounts as the app opens, from those kept and the one in use: the one in use among them, unless it is
// the demo, which the app opens in again without keeping it as an account.
export function accountsOnStart(login: Login | null, kept: Login[]): Login[] {
  if (!login || isDemo(login) || kept.some((a) => a.token === login.token)) return kept;
  return [...kept.filter((a) => !sameAccount(a, login)), login];
}
