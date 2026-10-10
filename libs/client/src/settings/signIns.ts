import type { Api } from '../base/api';
import { listed } from '../base/listed';

// The ways in to this server: passkeys, and the devices signed in with one or a password.
export type PasskeyRow = { id: string; name: string; createdAt: number; lastUsedAt: number | null };
export type LoginRow = { handle: string; createdAt: number; lastSeen: number; ua: string; method: string; current: boolean };

export const fetchPasskeys = (api: Api) => listed(api<PasskeyRow[]>('/api/auth/passkeys'));
// This device first, then the one seen most lately.
export const fetchLogins = (api: Api) =>
  listed(api<LoginRow[]>('/api/auth/logins').then((rows) => rows.sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeen - a.lastSeen)));
