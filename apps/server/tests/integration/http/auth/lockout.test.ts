import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/http/app.js';
import { Journal } from '../../../../src/journal/index.js';
import type { LocalMachine } from '../../../../src/sessions/machine.js';
import { Store } from '../../../../src/system/store.js';
import { addUser, ORIGIN, PASSWORD, RP_ID } from '../../../helpers/app.js';

const machine = {
  id: 'local',
  watch: () => () => {},
  onChange: () => () => {},
  listSessions: async () => [],
  journal: new Journal({ file: ':memory:', log: () => {} }),
} as unknown as LocalMachine;
let app: FastifyInstance;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ts-race-'));
  const store = new Store(join(dir, 'state.json'));
  await addUser(store);
  ({ app } = await buildApp({ store, machine, origin: ORIGIN, rpId: RP_ID, auditPath: join(dir, 'audit.log') }));
});

afterAll(() => app.close());

const attempt = (password: string) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '6.6.6.6' },
    payload: { username: 'alice', password },
  });

describe('Lockout', () => {
  it('locks out a burst of concurrent guesses exactly as it locks out sequential ones', async () => {
    const results = await Promise.all([...Array.from({ length: 12 }, () => attempt('wrong guess')), attempt(PASSWORD)]);
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 401)).toHaveLength(5);
    expect(codes.at(-1)).toBe(429);
    expect(codes).not.toContain(204);
  }, 30_000);
});
