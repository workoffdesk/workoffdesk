import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/http/app.js';
import { Journal } from '../../../../src/journal/index.js';
import type { LocalMachine } from '../../../../src/sessions/machine.js';
import { Store } from '../../../../src/system/store.js';
import { addUser, ORIGIN, RP_ID, signIn } from '../../../helpers/app.js';

// A session's journal as the phone reads it, against a machine that keeps what reached it.
const dir = mkdtempSync(join(tmpdir(), 'ts-journal-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const CONV = '0199cccc-0000-7000-8000-000000000001';
const projects = join(dir, 'projects');
mkdirSync(join(projects, '-work-proj'), { recursive: true });

const reached: [string, ...unknown[]][] = [];
let result: unknown = true;
const journal = new Journal({ file: ':memory:', log: () => {} });
const called = (name: string) => (...args: unknown[]) => (reached.push([name, ...args]), result);
const machine = {
  id: 'local',
  watch: () => () => {},
  onChange: () => () => {},
  listSessions: async () => [],
  journal,
  exists: async (id: string) => id === 'abc',
  sessionMeta: (id: string) => (id === 'abc' ? { kind: 'claude', claudeSessionId: CONV } : null),
  message: (id: string, qid: string) => ({ t: 'message', key: qid, session: id }),
  sendMessage: async (...a: unknown[]) => called('sendMessage')(...a),
  runCommand: async (...a: unknown[]) => called('runCommand')(...a),
  press: async (...a: unknown[]) => called('press')(...a),
  close: async (...a: unknown[]) => called('close')(...a),
  unsend: called('unsend'),
  sendNow: async (...a: unknown[]) => called('sendNow')(...a),
  moveQueued: called('moveQueued'),
  choose: async (...a: unknown[]) => called('choose')(...a),
  tick: async (...a: unknown[]) => called('tick')(...a),
  answer: called('answer'),
  onScreen: async (...a: unknown[]) => (called('onScreen')(...a), {}),
  ingest: async (...a: unknown[]) => void called('ingest')(...a),
} as unknown as LocalMachine;

let app: FastifyInstance;
let cookie = '';
beforeAll(async () => {
  const store = new Store(join(dir, 'state.json'));
  await addUser(store);
  ({ app } = await buildApp({ store, machine, origin: ORIGIN, rpId: RP_ID, auditPath: join(dir, 'audit.log'), claudeProjectsRoot: projects, media: { uploadsDir: join(dir, 'uploads') } }));
  cookie = await signIn(app);
});
afterAll(() => app.close());
beforeEach(() => {
  reached.length = 0;
  result = true;
});

const send = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/m/local/sessions/${url}`, headers: { origin: ORIGIN, cookie }, ...(payload !== undefined && { payload: payload as object }) });

describe('GET /api/m/:machine/sessions/:id/journal and /journal/items', () => {
  it("catches up from the version asked, after what the screen and the transcript have", async () => {
    journal.onMac('abc', 1);
    const r = await send('GET', `abc/journal?epoch=${journal.epoch}&v=0`);
    expect(r.json()).toMatchObject({ epoch: journal.epoch, reset: true, rows: [{ t: 'state', key: 'onMac', body: 1 }] });
    expect(reached).toEqual([['onScreen', 'abc'], ['ingest', 'abc']]);
    expect((await send('GET', `abc/journal?epoch=${journal.epoch}&v=${journal.heads().abc}`)).json()).toMatchObject({ rows: [], more: false });
  });

  it.each(['-1', '1.5', 'x', '1'.repeat(16), ''])('refuses the version %j', async (v) => {
    expect((await send('GET', `abc/journal?v=${v}`)).statusCode).toBe(400);
    expect(reached).toEqual([]);
  });

  it('gives pages of older items of a conversation', async () => {
    journal.putAgentItems('abc', CONV, [{ id: 'a0', item: { k: 'text', text: 'first' } }]);
    expect((await send('GET', `abc/journal/items?conv=${CONV}&before=5`)).json()).toMatchObject({ rows: [{ key: 'a0' }], older: null });
  });

  it.each([
    ['no conversation', 'before=5'],
    ['a conversation that is not one', 'conv=../x&before=5'],
    ['no place', `conv=${CONV}`],
    ['a place that is not a count', `conv=${CONV}&before=-1`],
  ])('gives no page for %s', async (_, query) => {
    expect((await send('GET', `abc/journal/items?${query}`)).statusCode).toBe(400);
  });

  it('finds nothing for a session there is not', async () => {
    expect((await send('GET', 'nosuch/journal')).statusCode).toBe(404);
    expect((await send('GET', `nosuch/journal/items?conv=${CONV}&before=1`)).statusCode).toBe(404);
  });
});
