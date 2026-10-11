import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { LocalMachine } from '../../../src/sessions/machine.js';
import { RUNS, machineSetup } from '../../helpers/machine.js';
import { until } from '../../helpers/until.js';

// A Claude or Codex session opened here stays in the list, and what was said in it can be read, until a person
// deletes it; however it leaves tmux, it is kept as past.
const { dir, tmux, make, restarted, argsFile } = machineSetup('mp');
afterAll(() => tmux.killServer());

const said = (text: string, uuid: string) => JSON.stringify({ type: 'user', uuid, cwd: dir, timestamp: new Date().toISOString(), message: { content: text } });

// A Claude session whose conversation has a transcript saying `lines`, taken into its journal.
async function withConversation(lines = ['hello']) {
  const projects = mkdtempSync(join(dir, 'p-'));
  const made = make({ claudeArgs: RUNS, claudeProjectsRoot: projects });
  const s = await made.m.createSession({ kind: 'claude', cwd: dir });
  mkdirSync(join(projects, 'here'), { recursive: true });
  const file = join(projects, 'here', `${s.claudeSessionId}.jsonl`);
  writeFileSync(file, lines.map((l, i) => `${said(l, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)}\n`).join(''));
  await made.m.ingest(s.id);
  return { ...made, s, file, projects };
}

const listed = async (m: LocalMachine, id: string) => (await m.listSessions()).find((x) => x.id === id);
const items = (m: LocalMachine, id: string) => m.journal.sync(id, undefined, 0).rows.filter((r) => r.t === 'item');

describe('a session that leaves tmux', () => {
  it.each([
    ['ended here', (m: LocalMachine, id: string) => m.killSession(id)],
    ['lost by tmux', async (_m: LocalMachine, id: string) => void (await tmux.killSession(`wod-${id}`))],
  ])('is listed as past once %s, ended, with its conversation still there to read', async (_, end) => {
    const { m, s } = await withConversation(['hello', 'and more']);
    expect(items(m, s.id).length, 'precondition: the journal has the conversation').toBe(2);
    await end(m, s.id);
    const row = await listed(m, s.id);
    expect(row).toMatchObject({ id: s.id, past: true, status: 'ended', kind: 'claude', claudeSessionId: s.claudeSessionId });
    expect(items(m, s.id)).toHaveLength(2);
    expect(await m.exists(s.id)).toBe(false);
  });

  it('is kept across a restart of the server', async () => {
    const { m, s, store } = await withConversation();
    await m.killSession(s.id);
    m.closeJournal();
    const after = restarted(store, { claudeArgs: RUNS });
    expect(await listed(after, s.id)).toMatchObject({ past: true });
    expect(items(after, s.id)).toHaveLength(1);
    after.closeJournal();
  });

  it('is dropped when it was a shell: there is nothing of it to read', async () => {
    const { m } = make();
    const s = await m.createSession({ kind: 'shell', cwd: dir });
    await m.killSession(s.id);
    expect(await listed(m, s.id)).toBeUndefined();
  });
});

describe('deleting', () => {
  it('a past session takes it and its journal away', async () => {
    const { m, s } = await withConversation();
    await m.killSession(s.id);
    await m.killSession(s.id);
    expect(await listed(m, s.id)).toBeUndefined();
    expect(items(m, s.id)).toHaveLength(0);
  });
});

describe('one conversation, one session', () => {
  it('lists no past session while a running one holds its conversation', async () => {
    const { m, s } = await withConversation();
    await m.killSession(s.id);
    const again = await m.createSession({ kind: 'claude', cwd: dir, resumeId: s.claudeSessionId });
    const rows = (await m.listSessions()).filter((x) => x.claudeSessionId === s.claudeSessionId);
    expect(rows.map((x) => x.id)).toEqual([again.id]);
  });

  it('lists no past session while a running one comes to hold its conversation', async () => {
    const { m, s, store } = await withConversation();
    await m.killSession(s.id);
    // Another session here whose Claude resumed that conversation on its own.
    const other = await m.createSession({ kind: 'claude', cwd: dir });
    store.update((st) => void (st.sessions[other.id].claudeSessionId = s.claudeSessionId));
    const rows = (await m.listSessions()).filter((x) => x.claudeSessionId === s.claudeSessionId);
    expect(rows.map((x) => x.id)).toEqual([other.id]);
  });

  it('keeps, of two past sessions of one conversation, the one with more of it', async () => {
    const { m, s, store } = await withConversation(['one', 'two', 'three']);
    await m.killSession(s.id);
    // A second session of the same conversation, whose journal has less of it.
    const other = await m.createSession({ kind: 'claude', cwd: dir });
    store.update((st) => void (st.sessions[other.id].claudeSessionId = s.claudeSessionId));
    await m.killSession(other.id);
    const rows = (await m.listSessions()).filter((x) => x.claudeSessionId === s.claudeSessionId);
    expect(rows.map((x) => x.id)).toEqual([s.id]);
    expect(items(m, s.id)).toHaveLength(3);
  });
});

it('renames a past session', async () => {
  const { m, s } = await withConversation();
  await m.killSession(s.id);
  expect(await m.renameSession(s.id, 'Kept name')).toMatchObject({ id: s.id, title: 'Kept name', past: true });
  expect((await listed(m, s.id))?.title).toBe('Kept name');
});

describe('going on with a past session', () => {
  it('brings it back in place: the same session, name and journal, its conversation resumed', async () => {
    const { m, s, store } = await withConversation(['one', 'two']);
    await m.killSession(s.id);
    await m.renameSession(s.id, 'Kept name');
    const back = await m.continueSession(s.id);
    expect(back).toMatchObject({ id: s.id, title: 'Kept name', claudeSessionId: s.claudeSessionId });
    expect(back.past).toBeUndefined();
    // The name given while it was past is on its way to Claude's conversation.
    expect(store.get().sessions[s.id].naming).toBe('Kept name');
    expect(await m.exists(s.id)).toBe(true);
    expect(items(m, s.id)).toHaveLength(2);
    expect(await until(() => readFileSync(argsFile, 'utf8').includes(s.claudeSessionId!))).toBe(true);
    expect(readFileSync(argsFile, 'utf8').split('\n')).toContain('--resume');
  });

  it('is what a resume of its conversation asked any other way goes into', async () => {
    const { m, s } = await withConversation();
    await m.killSession(s.id);
    const again = await m.createSession({ kind: 'claude', cwd: dir, resumeId: s.claudeSessionId });
    expect(again.id).toBe(s.id);
  });

  it('is refused when Claude no longer keeps the conversation, and stays past to read', async () => {
    const { m, s, file } = await withConversation();
    await m.killSession(s.id);
    rmSync(file);
    await expect(m.continueSession(s.id)).rejects.toMatchObject({ status: 409, code: 'conversation-gone' });
    expect(await listed(m, s.id)).toMatchObject({ past: true });
    expect(await m.exists(s.id)).toBe(false);
  });
});
