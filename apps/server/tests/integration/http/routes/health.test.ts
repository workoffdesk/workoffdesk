import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/http/app.js';
import { Journal } from '../../../../src/journal/index.js';
import type { LocalMachine } from '../../../../src/sessions/machine.js';
import { Store } from '../../../../src/system/store.js';
import { addUser, ORIGIN, RP_ID, signIn } from '../../../helpers/app.js';

const dir = mkdtempSync(join(tmpdir(), 'ts-health-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const machine = {
  id: 'local',
  watch: () => () => {},
  onChange: () => () => {},
  listSessions: async () => [],
  journal: new Journal({ file: ':memory:', log: () => {} }),
} as unknown as LocalMachine;

let app: FastifyInstance;
let cookie = '';
beforeAll(async () => {
  const store = new Store(join(dir, 'state.json'));
  await addUser(store);
  ({ app } = await buildApp({ store, machine, origin: ORIGIN, rpId: RP_ID, auditPath: join(dir, 'audit.log') }));
  cookie = await signIn(app);
});
afterAll(() => app.close());

describe('POST /api/slow and /api/chat-end', () => {
  const report = (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: { origin: ORIGIN, cookie }, payload: payload as object });

  it('takes the requests that were slow on it, and passes over the ones it cannot read', async () => {
    const slow = [{ method: 'GET', path: '/api/me', ms: 3200, outcome: 200 }, { method: 'GET', path: '/api/me', ms: 900, outcome: 'network' }, { path: 'https://elsewhere' }];
    expect((await report('/api/slow', { slow })).statusCode).toBe(204);
  });

  it.each([
    ['no list', {}],
    ['more than 20', { slow: Array.from({ length: 21 }, () => ({ method: 'GET', path: '/api/me', ms: 1, outcome: 200 })) }],
  ])('refuses a report of slow requests with %s', async (_, payload) => {
    expect((await report('/api/slow', payload)).statusCode).toBe(400);
  });

  it('takes what a chat measured when its end was hidden', async () => {
    expect((await report('/api/chat-end', { numbers: { contentHeight: 1200.5, inset: null } })).statusCode).toBe(204);
  });

  it.each([
    ['no numbers', {}],
    ['a list', { numbers: [1] }],
    ['a name that is not a word', { numbers: { 'a-b': 1 } }],
    ['a number that is not one', { numbers: { height: 'tall' } }],
    ['more than 16', { numbers: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`n${String.fromCharCode(97 + i)}`, i])) }],
  ])('refuses what a chat measured with %s', async (_, payload) => {
    expect((await report('/api/chat-end', payload)).statusCode).toBe(400);
  });
});
