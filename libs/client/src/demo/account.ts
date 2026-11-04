import { DEMO_SERVER } from './demoMac';

// An account the app keeps: a user on a server and the token that signs in to it. The demo is one, on a Mac only
// the app simulates (demoMac.ts).
export type Login = { server: string; token: string; user?: string; addresses?: string[] };
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

// Where an account's Mac is reached: the address signed in to first, then the others it named.
export const addressesOf = (l: Login): string[] => l.addresses ?? [l.server];

// An origin the Mac may be asked at with the login: https only, so the token never goes out in the clear.
const ORIGIN = /^https:\/\/[^/\s?#]+$/i;

// The addresses of a login's Mac from what /api/addresses answered: the one signed in to, then every https
// origin it named.
export function learnedAddresses(l: Login, said: unknown): string[] {
  const named = (said as { addresses?: unknown } | null)?.addresses;
  const origins = Array.isArray(named) ? named.filter((a): a is string => typeof a === 'string' && ORIGIN.test(a)) : [];
  return [...new Set([l.server, ...origins])];
}

// The accounts with every other one of the same user at an address of the login's Mac folded into the login;
// gone: those folded, to be signed out on the Mac.
export function foldAccounts(accounts: Login[], l: Login): { kept: Login[]; gone: Login[] } {
  const at = new Set(addressesOf(l));
  const same = (a: Login) => sameAccount(a, l);
  const gone = accounts.filter((a) => !same(a) && (a.user ?? '') === (l.user ?? '') && at.has(a.server));
  return { kept: accounts.filter((a) => !gone.includes(a)).map((a) => (same(a) ? l : a)), gone };
}
