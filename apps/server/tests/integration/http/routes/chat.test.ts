import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/http/app.js';
import { Journal } from '../../../../src/journal/index.js';
import type { LocalMachine } from '../../../../src/sessions/machine.js';
import { Store } from '../../../../src/system/store.js';
import { addUser, ORIGIN, RP_ID, signIn } from '../../../helpers/app.js';

// What the phone sends a session from its chat, against a machine that keeps what reached it: a request
// the route refuses must reach nothing, since keys and commands are typed into a terminal.
const dir = mkdtempSync(join(tmpdir(), 'ts-chat-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const CONV = '0199cccc-0000-7000-8000-000000000001';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c80000000049454e44ae426082', 'hex');
const projects = join(dir, 'projects');
mkdirSync(join(projects, '-work-proj'), { recursive: true });
const shot = join(dir, 'shot.png');
writeFileSync(shot, PNG);
writeFileSync(join(projects, '-work-proj', `${CONV}.jsonl`), `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `Saved ${shot} and ${join(dir, 'gone.png')}` }] } })}\n`);

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

describe('POST /api/m/:machine/sessions/:id/messages', () => {
  it('sends the message under the id the page gave it, and answers it as the journal has it', async () => {
    result = false;
    const r = await send('POST', 'abc/messages', { text: 'fix it', id: 'page-msg-0001' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ queued: false, message: { t: 'message', key: 'page-msg-0001', session: 'abc' } });
    expect(reached).toEqual([['sendMessage', 'abc', 'fix it', 'page-msg-0001']]);
  });

  it('gives the message an id of its own when the page gave none', async () => {
    await send('POST', 'abc/messages', { text: 'fix it' });
    expect(reached).toEqual([['sendMessage', 'abc', 'fix it', expect.stringMatching(/^[0-9a-f]{16}$/)]]);
  });

  it.each([
    ['no text', {}, 'text required'],
    ['empty text', { text: '' }, 'text required'],
    ['text that is not text', { text: ['fix'] }, 'text required'],
    ['an id too short', { text: 'x', id: 'short' }, 'bad message id'],
    ['an id too long', { text: 'x', id: 'a'.repeat(65) }, 'bad message id'],
    ['an id with a path in it', { text: 'x', id: '../../state.json' }, 'bad message id'],
    ['an id that is a number', { text: 'x', id: 12345678 }, 'bad message id'],
  ])('refuses one with %s', async (_, body, error) => {
    const r = await send('POST', 'abc/messages', body);
    expect([r.statusCode, r.json().error]).toEqual([400, error]);
    expect(reached).toEqual([]);
  });

  it('refuses one for a session there is not', async () => {
    expect((await send('POST', 'nosuch/messages', { text: 'fix it' })).statusCode).toBe(404);
    expect(reached).toEqual([]);
  });
});

describe('/api/m/:machine/sessions/:id/messages/:qid', () => {
  it('takes a held message back, giving its text back for the composer', async () => {
    result = 'fix it';
    const r = await send('DELETE', 'abc/messages/q1');
    expect(r.json()).toEqual({ text: 'fix it', message: { t: 'message', key: 'q1', session: 'abc' } });
    result = null;
    expect((await send('DELETE', 'abc/messages/q1')).statusCode).toBe(404);
  });

  it.each<[string, unknown, string]>([
    ['sent now, out of its turn', undefined, 'sendNow'],
    ['moved a place earlier', -1, 'moveQueued'],
    ['moved a place later', 1, 'moveQueued'],
  ])('has it %s', async (_, move, how) => {
    const r = await send('POST', 'abc/messages/q1', move === undefined ? {} : { move });
    expect(r.statusCode).toBe(200);
    expect(reached).toEqual([[how, 'abc', 'q1', ...(move === undefined ? [] : [move])]]);
    result = false;
    expect((await send('POST', 'abc/messages/q1', move === undefined ? {} : { move })).statusCode).toBe(404);
  });

  it.each([2, 0, '1', null])('does not move it by %j', async (move) => {
    expect((await send('POST', 'abc/messages/q1', { move })).statusCode).toBe(400);
    expect(reached).toEqual([]);
  });
});

describe('POST /api/m/:machine/sessions/:id/command', () => {
  it.each(['/compact', '/effort high', '/model opus[1m]', '/plugin:skill-name', '/model claude-opus-5.5'])('runs %s', async (command) => {
    result = { ran: true };
    const r = await send('POST', 'abc/command', { command });
    expect(r.json()).toEqual({ ran: true });
    expect(reached).toEqual([['runCommand', 'abc', command]]);
  });

  it('says what the screen shows when it did not run', async () => {
    result = { ran: false, screen: 'a dialog' };
    expect((await send('POST', 'abc/command', { command: '/compact' })).json()).toEqual({ ran: false, screen: 'a dialog' });
  });

  it.each([
    ['words, not a command', 'fix it'],
    ['a command in capitals', '/Compact'],
    ['two things after it', '/model opus sonnet'],
    ['another line', '/compact\nrm -rf ~'],
    ['a shell after it', '/effort high; rm -rf ~'],
    ['a name too long', `/${'a'.repeat(42)}`],
    ['what it is given too long', `/effort ${'a'.repeat(41)}`],
    ['nothing', ''],
    ['no text', 7],
  ])('types nothing when it is %s', async (_, command) => {
    expect((await send('POST', 'abc/command', { command })).statusCode).toBe(400);
    expect(reached).toEqual([]);
  });

  it('types nothing into a session there is not', async () => {
    expect((await send('POST', 'nosuch/command', { command: '/compact' })).statusCode).toBe(404);
    expect(reached).toEqual([]);
  });
});

describe('POST /api/m/:machine/sessions/:id/keys and /close', () => {
  it('presses them, as many as a slider pushed end to end, and answers the screen after them', async () => {
    result = 'the screen';
    const keys = '→'.repeat(200);
    expect((await send('POST', 'abc/keys', { keys })).json()).toEqual({ screen: 'the screen' });
    expect(reached).toEqual([['press', 'abc', keys]]);
  });

  it.each([
    ['none', ''],
    ['more than 200', 'x'.repeat(201)],
    ['not text', ['Enter']],
  ])('presses none when they are %s', async (_, keys) => {
    expect((await send('POST', 'abc/keys', { keys })).statusCode).toBe(400);
    expect(reached).toEqual([]);
  });

  it('presses none in a session there is not, nor closes a dialog there', async () => {
    expect((await send('POST', 'nosuch/keys', { keys: 'x' })).statusCode).toBe(404);
    expect((await send('POST', 'nosuch/close')).statusCode).toBe(404);
    expect(reached).toEqual([]);
  });

  it('closes the dialog on the ✕', async () => {
    result = 'after';
    expect((await send('POST', 'abc/close')).json()).toEqual({ screen: 'after' });
    expect(reached).toEqual([['close', 'abc']]);
  });
});

describe('POST /api/m/:machine/sessions/:id/choices', () => {
  it('presses one option, by its place and its name, with what is typed into it', async () => {
    expect((await send('POST', 'abc/choices', { index: 2, label: 'Other', text: 'use pnpm' })).statusCode).toBe(204);
    expect(reached).toEqual([['choose', 'abc', 2, 'Other', 'use pnpm']]);
  });

  it('ticks several', async () => {
    expect((await send('POST', 'abc/choices', { ticked: [0, 2], labels: ['A', 'C'] })).statusCode).toBe(204);
    expect(reached).toEqual([['tick', 'abc', [0, 2], ['A', 'C']]]);
  });

  it('tells the options changed when what it names is not on screen any more', async () => {
    result = false;
    const r = await send('POST', 'abc/choices', { index: 0, label: 'Yes' });
    expect([r.statusCode, r.json().error]).toEqual([409, 'the options have changed']);
  });

  it.each([
    ['no place', { label: 'Yes' }],
    ['a place below the first', { index: -1, label: 'Yes' }],
    ['a place that is not whole', { index: 0.5, label: 'Yes' }],
    ['no name', { index: 0 }],
    ['blank words typed in', { index: 0, label: 'Other', text: '  ' }],
    ['words that are not text', { index: 0, label: 'Other', text: 3 }],
    ['ticks with no names', { ticked: [0] }],
    ['names with no ticks', { labels: ['A'] }],
    ['a tick that is not a place', { ticked: ['0'], labels: ['A'] }],
    ['a name that is not text', { ticked: [0], labels: [0] }],
  ])('is refused with %s', async (_, body) => {
    expect((await send('POST', 'abc/choices', body)).statusCode).toBe(400);
    expect(reached).toEqual([]);
  });
});

describe('POST /api/m/:machine/sessions/:id/asks/:askId', () => {
  it.each<[string, object, object]>([
    ['Yes', { allow: true }, { allow: true }],
    ['Yes, and from now on', { allow: true, always: true }, { allow: true, always: true }],
    ['No', { allow: false }, { allow: false }],
  ])('%s goes to the ask it was given for', async (_, body, answer) => {
    expect((await send('POST', 'abc/asks/ask-1', body)).statusCode).toBe(204);
    expect(reached).toEqual([['answer', 'abc', 'ask-1', answer]]);
  });

  it('tells the ask is over when it was answered or passed by', async () => {
    result = false;
    expect((await send('POST', 'abc/asks/ask-1', { allow: true })).statusCode).toBe(409);
  });

  it.each([
    ['no answer', {}],
    ['an answer that is not yes or no', { allow: 'yes' }],
    ['No from now on', { allow: false, always: true }],
    ['from now on said other than as true', { allow: true, always: false }],
  ])('is refused with %s', async (_, body) => {
    expect((await send('POST', 'abc/asks/ask-1', body)).statusCode).toBe(400);
    expect(reached).toEqual([]);
  });
});

describe('GET /api/m/:machine/sessions/:id/image', () => {
  const image = (path: string | undefined, id = 'abc') => send('GET', `${id}/image${path === undefined ? '' : `?path=${encodeURIComponent(path)}`}`);

  it('shows it as an image only, kept a while', async () => {
    const r = await image(shot);
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload).toEqual(PNG);
    expect([r.headers['content-type'], r.headers['x-content-type-options'], r.headers['cache-control']]).toEqual(['image/png', 'nosniff', 'private, max-age=300']);
  });

  it.each<[string, string | undefined, string, number]>([
    ['no path is asked for', undefined, 'abc', 400],
    ['the session is not there', shot, 'nosuch', 404],
    ['the transcript never named it', join(dir, 'state.json'), 'abc', 403],
    ['it is gone', join(dir, 'gone.png'), 'abc', 404],
  ])('shows nothing when %s', async (_, path, id, status) => {
    expect((await image(path, id)).statusCode).toBe(status);
  });
});
