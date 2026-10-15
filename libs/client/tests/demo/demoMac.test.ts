import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@workoffdesk/i18n';
import { ApiError, createApi, errorText, MACHINE, type TermSession } from '../../src/base/api';
import { createChatFeeds } from '../../src/chat/chatFeed';
import { createDemoMac, DEMO_SERVER } from '../../src/demo/demoMac';
import { createJournals } from '../../src/journal/journal';
import { createSessionLinks, type LinkState } from '../../src/sessions/sessionLink';
import { createSessionList } from '../../src/sessions/sessionList';
import { createSession } from '../../src/sessions/newSession';
import { fakeVisibility, flush, memoryStorage } from '../helpers/fakes';

// The client the app runs, on the Mac the demo simulates.
function demo() {
  const mac = createDemoMac({ lang: 'en' });
  const { api } = createApi({ base: () => DEMO_SERVER, onUnauthorized: () => {}, fetch: mac.fetch });
  const visibility = fakeVisibility(true);
  const list = createSessionList({ open: mac.open, storage: memoryStorage(), visibility, onSignedOut: () => {}, ask: () => api('/api/events/now') });
  const journals = createJournals({ api, newId: (() => { let n = 0; return () => `m${++n}`; })() });
  const links = createSessionLinks({ open: mac.open, visibility, onSignedOut: () => {} });
  const stops: (() => void)[] = [];
  // A session's page: its line and its journal copy, followed.
  const page = (id: string) => {
    const states: LinkState[] = [];
    const line = links.open(id, visibility, (s) => states.push(s));
    stops.push(journals.follow(id, visibility), line.close);
    return { line, states, view: () => journals.view(id) };
  };
  const listed = () => {
    stops.push(list.subscribe(() => {}));
    return () => list.current() ?? [];
  };
  return { mac, api, list, journals, page, listed, stop: () => stops.splice(0).forEach((f) => f()) };
}

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
};
const texts = (d: ReturnType<typeof demo>, id: string) => d.journals.view(id).items.map((i) => ('text' in i ? i.text : i.k));

let d: ReturnType<typeof demo>;
beforeEach(() => {
  vi.useFakeTimers();
  d = demo();
});
afterEach(() => {
  d.stop();
  vi.useRealTimers();
});

describe('the Mac the demo simulates', () => {
  it('lists its sessions, a Claude one that is done, one that works while it is looked at, and a Codex one', async () => {
    const rows = d.listed();
    await settle(100);
    const sessions: TermSession[] = rows();
    expect(sessions.map((s) => s.kind).sort()).toEqual(['claude', 'claude', 'codex']);
    expect(sessions.map((s) => s.status).sort()).toEqual(['idle', 'idle', 'working']);
    expect(sessions.every((s) => s.title && s.cwd && s.lastActivity)).toBe(true);
  });

  it('gives a session its conversation, with tool calls and their results', async () => {
    const [done] = (await d.api<TermSession[]>(`/api/m/${MACHINE}/sessions`)).filter((s) => s.kind === 'claude' && s.status === 'idle');
    const p = d.page(done.id);
    await settle(100);
    const items = p.view().items;
    expect(p.view().synced).toBe(true);
    expect(p.view().status).toBe('idle');
    expect(items[0].k).toBe('user');
    expect(items.some((i) => i.k === 'tool' && i.name === 'Edit')).toBe(true);
    expect(items.some((i) => i.k === 'result' && i.diff)).toBe(true);
    expect(items.some((i) => i.k === 'tool' && i.name === 'Agent')).toBe(true);
    expect(items.at(-1)?.k).toBe('text');
    expect(p.states).toContain('live');
  });

  it('starts a copy kept from an earlier demo over', async () => {
    const [s] = await d.api<TermSession[]>(`/api/m/${MACHINE}/sessions`);
    const earlier = await d.api<{ epoch: string; v: number }>(`/api/m/${MACHINE}/sessions/${s.id}/journal?epoch=&v=0`);
    d.stop();
    d = demo();
    const sync = await d.api<{ epoch: string; reset?: true; rows: unknown[] }>(`/api/m/${MACHINE}/sessions/${s.id}/journal?epoch=${earlier.epoch}&v=${earlier.v}`);
    expect(sync.epoch).not.toBe(earlier.epoch);
    expect(sync.reset).toBe(true);
    expect(sync.rows.length).toBeGreaterThan(0);
  });

  it('answers a message: it lands as a turn, Claude works on it and replies, then is idle', async () => {
    const rows = d.listed();
    await settle(100);
    const done = rows().find((s) => s.kind === 'claude' && s.status === 'idle')!;
    const p = d.page(done.id);
    await settle(100);
    const before = p.view().items.length;
    const statuses = new Set<string | null>();
    d.journals.subscribe(done.id, () => statuses.add(d.journals.view(done.id).status));

    await d.journals.send(done.id, 'Make it blue');
    await settle(1000);
    expect(p.view().items[before]).toMatchObject({ k: 'user', text: 'Make it blue' });
    expect(p.view().messages).toEqual([expect.objectContaining({ id: 'm1', state: 'landed', item: p.view().items[before].itemId })]);
    expect(p.view().status).toBe('working');

    await settle(30_000);
    expect(statuses).toContain('working');
    expect(p.view().status).toBe('idle');
    const added = p.view().items.slice(before + 1);
    expect(added.some((i) => i.k === 'tool')).toBe(true);
    expect(added.at(-1)).toMatchObject({ k: 'text', text: expect.stringContaining('Make it blue') });
    expect(rows().find((s) => s.id === done.id)?.status).toBe('idle');
  });

  it('takes a message posted again under the same id once, as the Mac does', async () => {
    const [s] = (await d.api<TermSession[]>(`/api/m/${MACHINE}/sessions`)).filter((x) => x.kind === 'claude' && x.status === 'idle');
    const post = () => d.api(`/api/m/${MACHINE}/sessions/${s.id}/messages`, { method: 'POST', json: { text: 'once', id: 'q1' } });
    await post();
    await post();
    await settle(60_000);
    const p = d.page(s.id);
    await settle(100);
    expect(texts(d, s.id).filter((x) => x === 'once')).toEqual(['once']);
    expect(p.view().items.filter((i) => i.k === 'text' && i.text.includes('"once"'))).toHaveLength(1);
  });

  it('takes a message sent while it answers into its queue, and answers it next', async () => {
    const [s] = (await d.api<TermSession[]>(`/api/m/${MACHINE}/sessions`)).filter((x) => x.kind === 'claude' && x.status === 'idle');
    const p = d.page(s.id);
    await settle(100);
    await d.journals.send(s.id, 'first');
    await settle(100);
    await d.journals.send(s.id, 'second');
    await settle(100);
    expect(p.view().messages.find((m) => m.text === 'second')?.state).toBe('queued');
    await settle(60_000);
    expect(p.view().messages.map((m) => m.state)).toEqual(['landed', 'landed']);
    expect(texts(d, s.id).filter((x) => x === 'first' || x === 'second')).toEqual(['first', 'second']);
    expect(p.view().status).toBe('idle');
  });

  it.each([
    ['Esc on the line', (p: { line: { send: (x: string) => boolean } }) => void p.line.send('\x1b')],
    ['^C on the line', (p: { line: { send: (x: string) => boolean } }) => void p.line.send('\x03')],
    ['Esc as a request', (_p: unknown, id: string) => void d.api(`/api/m/${MACHINE}/sessions/${id}/keys`, { method: 'POST', json: { keys: '\x1b' } })],
  ])('stops a reply under way at %s, saying so, and is idle', async (_how, press) => {
    const [s] = (await d.api<TermSession[]>(`/api/m/${MACHINE}/sessions`)).filter((x) => x.kind === 'claude' && x.status === 'idle');
    const p = d.page(s.id);
    await settle(100);
    await d.journals.send(s.id, 'Make it blue');
    await settle(1500);
    expect(p.view().status).toBe('working');
    press(p, s.id);
    await settle(100);
    expect(p.view().status).toBe('idle');
    expect(p.view().items.at(-1)).toMatchObject({ k: 'note', event: { e: 'interrupted' } });
    const n = p.view().items.length;
    await settle(60_000);
    expect(p.view().items.length).toBe(n);
  });

  it('answers the message waiting next once a reply is stopped', async () => {
    const [s] = (await d.api<TermSession[]>(`/api/m/${MACHINE}/sessions`)).filter((x) => x.kind === 'claude' && x.status === 'idle');
    const p = d.page(s.id);
    await settle(100);
    await d.journals.send(s.id, 'first');
    await settle(1000);
    await d.journals.send(s.id, 'second');
    await settle(100);
    p.line.send('\x1b');
    await settle(60_000);
    expect(p.view().messages.map((m) => m.state)).toEqual(['landed', 'landed']);
    expect(p.view().items.at(-1)).toMatchObject({ k: 'text', text: expect.stringContaining('second') });
  });

  it('stops a tool call under way with the reply, as never having run', async () => {
    const [s] = (await d.api<TermSession[]>(`/api/m/${MACHINE}/sessions`)).filter((x) => x.kind === 'claude' && x.status === 'idle');
    const p = d.page(s.id);
    await settle(100);
    await d.journals.send(s.id, 'Make it blue');
    await settle(3200);
    const call = p.view().items.at(-1);
    expect(call).toMatchObject({ k: 'tool' });
    p.line.send('\x1b');
    await settle(100);
    expect(p.view().items.slice(-2)).toEqual([
      expect.objectContaining({ k: 'result', id: (call as { id: string }).id, stopped: true }),
      expect.objectContaining({ k: 'note', event: { e: 'interrupted' } }),
    ]);
  });

  it('works on, while looked at, in the session that is working, and is done in time', async () => {
    const rows = d.listed();
    await settle(100);
    const busy = rows().find((s) => s.status === 'working')!;
    const p = d.page(busy.id);
    await settle(100);
    expect(p.view().tasks.length).toBeGreaterThan(0);
    const n = p.view().items.length;
    await settle(120_000);
    expect(p.view().items.length).toBeGreaterThan(n);
    expect(p.view().status).toBe('idle');
    expect(p.view().tasks.every((x) => x.status === 'completed')).toBe(true);
    expect(rows().find((s) => s.id === busy.id)?.status).toBe('idle');
  });

  it("answers a sub-agent's description and its conversation, by the call that started it", async () => {
    const [s] = (await d.api<TermSession[]>(`/api/m/${MACHINE}/sessions`)).filter((x) => x.kind === 'claude' && x.status === 'idle');
    const p = d.page(s.id);
    await settle(100);
    const call = p.view().items.find((i) => i.k === 'tool' && i.name === 'Agent') as { id: string; summary: string };
    const sid = s.claudeSessionId!;
    await expect(d.api(`/api/claude/sessions/${sid}/agents/${call.id}`)).resolves.toEqual({ description: call.summary });
    const feeds = createChatFeeds({ api: d.api });
    const shown: { items: unknown[] }[] = [];
    const f = feeds.follow(`demo:${call.id}`, `/api/claude/sessions/${sid}/agents/${call.id}/chat`, { show: (c) => void shown.push(c), failed: () => {}, loadingOlder: () => {} }, fakeVisibility(true));
    await settle(100);
    f.stop();
    expect(shown.at(-1)?.items.length).toBeGreaterThan(1);
    await expect(d.api(`/api/claude/sessions/${sid}/agents/toolu_none`)).rejects.toMatchObject({ status: 404 });
  });

  it('starts a session in one of its folders, which joins the list and answers, and ends it', async () => {
    const rows = d.listed();
    await settle(100);
    const projects = await d.api<string[]>('/api/claude/projects');
    expect(projects.length).toBeGreaterThan(0);
    const made = await createSession(d.api, { kind: 'claude', cwd: projects[0] });
    await settle(100);
    expect(rows().map((s) => s.id)).toContain(made.id);
    const p = d.page(made.id);
    await settle(100);
    expect(p.view().items).toEqual([]);
    await d.journals.send(made.id, 'hello');
    await settle(60_000);
    expect(p.view().items.at(-1)?.k).toBe('text');

    await d.api(`/api/m/${MACHINE}/sessions/${made.id}`, { method: 'DELETE' });
    await settle(100);
    expect(rows().map((s) => s.id)).not.toContain(made.id);
  });

  it('refuses what it does not simulate, in words the app shows', async () => {
    const refused = await d.api('/api/mac').catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 409, code: 'demo' });
    expect(errorText(refused, 'fallback')).toBe(t.serverErrors.demo);
  });

  it('takes what the app sends on its own, and does nothing with it', async () => {
    for (const [path, json] of [['/api/push/apns', { token: 'x' }], ['/api/slow', { slow: {} }], ['/api/chat-end', { numbers: {} }]] as const)
      await expect(d.api(path, { method: 'POST', json })).resolves.not.toThrow;
    await expect(d.api('/api/auth/logout', { method: 'POST' })).resolves.toBeDefined();
  });
});
