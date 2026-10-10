import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { hashPassword } from '../../src/http/auth/password.js';
import type { Store } from '../../src/system/store.js';

export const ORIGIN = 'https://workoffdesk.example.test';
export const RP_ID = 'workoffdesk.example.test';
export const PASSWORD = 'correct horse battery';

// The one user, alice, signing in with PASSWORD.
export async function addUser(store: Store): Promise<void> {
  const hash = await hashPassword(PASSWORD);
  store.update((s) => {
    s.user = { username: 'alice', hash };
  });
}

// Signs alice in and gives the cookie a signed-in device sends.
export async function signIn(app: FastifyInstance): Promise<string> {
  const login = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { origin: ORIGIN }, payload: { username: 'alice', password: PASSWORD } });
  expect(login.statusCode).toBe(204);
  return [login.headers['set-cookie']].flat().map((c) => String(c).split(';')[0]).join('; ');
}
