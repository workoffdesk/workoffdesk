import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readChat, readChatBefore } from '../../../../src/agents/claude/transcript/transcriptFile.js';
import { buildApp } from '../../../../src/http/app.js';
import { Journal } from '../../../../src/journal/index.js';
import type { LocalMachine } from '../../../../src/sessions/machine.js';
import { Store } from '../../../../src/system/store.js';
import { addUser, ORIGIN, RP_ID, signIn } from '../../../helpers/app.js';

// A Claude conversation read on the phone before it is picked up here, and a take-over given up.
const CONV = '0199cccc-0000-7000-8000-000000000001';
const OTHER = '0199cccc-0000-7000-8000-000000000002';
const dir = mkdtempSync(join(tmpdir(), 'ts-claude-routes-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const projects = join(dir, 'projects');
mkdirSync(join(projects, '-work-proj'), { recursive: true });
const transcript = join(projects, '-work-proj', `${CONV}.jsonl`);
const turn = (i: number) => [
  { type: 'user', uuid: `u-${i}`, timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: `Question ${i}` } },
  { type: 'assistant', uuid: `a-${i}`, timestamp: '2026-10-08T10:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: `Answer ${i}` }] } },
];
writeFileSync(transcript, `${Array.from({ length: 150 }, (_, i) => turn(i)).flat().map((l) => JSON.stringify(l)).join('\n')}\n`);
const SIZE = statSync(transcript).size;
// A conversation outside Claude Code's projects folder is not read.
writeFileSync(join(dir, `${OTHER}.jsonl`), `${JSON.stringify(turn(0)[0])}\n`);

// A sub-agent the conversation started, by the call that started it.
const TOOL = 'toolu_01AbCd';
const subagents = join(projects, '-work-proj', CONV, 'subagents');
mkdirSync(subagents, { recursive: true });
writeFileSync(join(subagents, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Find the callers', toolUseId: TOOL }));
const agentTranscript = join(subagents, 'agent-a1.jsonl');
writeFileSync(agentTranscript, `${turn(0).map((r) => JSON.stringify({ ...r, isSidechain: true })).join('\n')}\n`);

const cancelled: string[] = [];
const machine = {
  id: 'local',
  watch: () => () => {},
  onChange: () => () => {},
  listSessions: async () => [],
  journal: new Journal({ file: ':memory:', log: () => {} }),
  cancelTakeOver: (sid: string) => (cancelled.push(sid), sid === CONV),
} as unknown as LocalMachine;

let app: FastifyInstance;
let cookie = '';
beforeAll(async () => {
  const store = new Store(join(dir, 'state.json'));
  await addUser(store);
  ({ app } = await buildApp({ store, machine, origin: ORIGIN, rpId: RP_ID, auditPath: join(dir, 'audit.log'), claudeProjectsRoot: projects }));
  cookie = await signIn(app);
});
afterAll(() => app.close());

const get = (url: string) => app.inject({ method: 'GET', url, headers: { origin: ORIGIN, cookie } });
const chat = (sid: string, query = '') => get(`/api/claude/sessions/${sid}/chat${query}`);

describe('GET /api/claude/sessions/:sid/chat', () => {
  it('gives its latest turns, as a session chat has them', async () => {
    const latest = await readChat(transcript, 0);
    expect(latest.items.length).toBeGreaterThan(0);
    expect(latest.from).toBeGreaterThan(0);
    const r = await chat(CONV);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(JSON.parse(JSON.stringify({ sid: CONV, ...latest })));
  });

  it('goes on from where the phone read up to, or back from where it began', async () => {
    const { from } = await readChat(transcript, 0);
    const earlier = await readChatBefore(transcript, from);
    expect(earlier.items.length).toBeGreaterThan(0);
    expect((await chat(CONV, `?sid=${CONV}&before=${from}`)).json()).toEqual(JSON.parse(JSON.stringify({ sid: CONV, ...earlier })));
    const half = Math.floor(SIZE / 2);
    expect((await chat(CONV, `?sid=${CONV}&from=${half}`)).json()).toEqual(JSON.parse(JSON.stringify({ sid: CONV, ...(await readChat(transcript, half)) })));
  });

  it('starts over at its latest turns when where the phone read up to was in another conversation', async () => {
    const latest = JSON.parse(JSON.stringify({ sid: CONV, ...(await readChat(transcript, 0)) }));
    expect((await chat(CONV, `?sid=${OTHER}&before=100`)).json()).toEqual(latest);
    expect((await chat(CONV, '?from=100')).json()).toEqual(latest);
  });

  it.each([
    ['a conversation outside the projects folder', OTHER],
    ['a name that is no conversation id', 'latest'],
    ['a path out of the projects folder', `..%2F${OTHER}`],
  ])('finds nothing for %s', async (_, sid) => {
    const r = await chat(sid);
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'no such conversation' });
  });

  it.each(['-1', '1.5', 'x', String(2 ** 60)])('refuses a place in it that is not one: %s', async (n) => {
    expect((await chat(CONV, `?sid=${CONV}&from=${n}`)).json()).toEqual({ error: 'bad from' });
    expect((await chat(CONV, `?sid=${CONV}&before=${n}`)).json()).toEqual({ error: 'bad before' });
    expect((await chat(CONV, `?sid=${CONV}&before=${n}`)).statusCode).toBe(400);
  });
});

describe('a sub-agent the conversation started', () => {
  const agentChat = (sid: string, tool: string, query = '') => get(`/api/claude/sessions/${sid}/agents/${tool}/chat${query}`);

  it('gives its conversation as its own, the same way as the conversation that started it', async () => {
    const r = await agentChat(CONV, TOOL);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(JSON.parse(JSON.stringify({ sid: TOOL, ...(await readChat(agentTranscript, 0, { sidechain: true })) })));
    expect(r.json().items.map((i: { text: string }) => i.text)).toEqual(['Question 0', 'Answer 0']);
  });

  it('goes on from where the phone read up to', async () => {
    const firstLine = Buffer.byteLength(`${JSON.stringify({ ...turn(0)[0], isSidechain: true })}\n`);
    const r = (await agentChat(CONV, TOOL, `?sid=${TOOL}&from=${firstLine}`)).json();
    expect(r).toMatchObject({ sid: TOOL, from: firstLine });
    expect(r.items.map((i: { text: string }) => i.text)).toEqual(['Answer 0']);
  });

  it('says what it was started to do', async () => {
    const r = await get(`/api/claude/sessions/${CONV}/agents/${TOOL}`);
    expect(r.json()).toEqual({ description: 'Find the callers' });
  });

  it.each([
    ['a call that started none', CONV, 'toolu_01Other'],
    ['a conversation that started none', OTHER, TOOL],
    ['a path for the call', CONV, '..%2Fagent-a1'],
  ])('finds nothing for %s', async (_, sid, tool) => {
    for (const r of [await agentChat(sid, tool), await get(`/api/claude/sessions/${sid}/agents/${tool}`)]) {
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual({ error: 'no such sub-agent' });
    }
  });

  it('refuses a place in it that is not one', async () => {
    expect((await agentChat(CONV, TOOL, `?sid=${TOOL}&from=-1`)).statusCode).toBe(400);
  });
});

describe('DELETE /api/claude/sessions/:sid/take-over', () => {
  it('stops the wait for the conversation it names', async () => {
    cancelled.length = 0;
    const r = await app.inject({ method: 'DELETE', url: `/api/claude/sessions/${CONV}/take-over`, headers: { origin: ORIGIN, cookie } });
    expect(r.statusCode).toBe(204);
    expect(cancelled).toEqual([CONV]);
  });

  it('finds nothing when nothing was waiting for it', async () => {
    const r = await app.inject({ method: 'DELETE', url: `/api/claude/sessions/${OTHER}/take-over`, headers: { origin: ORIGIN, cookie } });
    expect([r.statusCode, r.json()]).toEqual([404, { error: 'not waiting' }]);
  });
});
