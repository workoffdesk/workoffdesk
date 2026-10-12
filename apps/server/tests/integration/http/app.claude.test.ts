import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { liveServer } from '../../helpers/server.js';
import { until } from '../../helpers/until.js';

// A Claude that runs until its session is ended, and says no Claude is open in a terminal.
const runs = join(mkdtempSync(join(tmpdir(), 'ts-cl-bin-')), 'claude');
writeFileSync(runs, `#!/bin/sh\nif [ "$1" = agents ]; then echo '[]'; exit 0; fi\nexec sleep 600\n`);
chmodSync(runs, 0o755);
const live = liveServer('cl', { signedIn: true, claudeBin: runs });
const { dir, store, claudeRoot, claudeJobsRoot, claudeDir, api, openWs } = live;

mkdirSync(join(claudeRoot, '-proj'), { recursive: true });
// Where the listed conversations were had: a temporary folder's are throwaway runs and are not listed.
const PROJECT = '/Users/someone/proj';
const RESUME_ID = '0b9c2a7e-1111-4222-8333-944445555666';
writeFileSync(
  join(claudeRoot, '-proj', `${RESUME_ID}.jsonl`),
  `${JSON.stringify({ type: 'user', cwd: PROJECT, message: { content: 'hello there' } })}\n${JSON.stringify({ type: 'ai-title', aiTitle: 'Earlier chat' })}\n`,
);
// A conversation a Claude Code background session holds.
const HELD_ID = '6e36fce3-f9fd-4ac2-ba5e-50e10fdb01db';
writeFileSync(join(claudeRoot, '-proj', `${HELD_ID}.jsonl`), `${JSON.stringify({ type: 'user', cwd: PROJECT, message: { content: 'held elsewhere' } })}\n`);
mkdirSync(join(claudeJobsRoot, '6e36fce3'), { recursive: true });
writeFileSync(join(claudeJobsRoot, '6e36fce3', 'state.json'), JSON.stringify({ state: 'blocked', linkScanPath: join(claudeRoot, '-proj', `${HELD_ID}.jsonl`) }));
mkdirSync(join(claudeDir, 'skills', 'lesson'), { recursive: true });
writeFileSync(join(claudeDir, 'skills', 'lesson', 'SKILL.md'), '---\nname: lesson\ndescription: 记一条经验\n---\n');
mkdirSync(join(dir, '.claude', 'commands'), { recursive: true });
writeFileSync(join(dir, '.claude', 'commands', 'release.md'), 'Cut a release\n');

describe('GET /api/claude/recent', () => {
  it('lists recent claude sessions', async () => {
    const recent = await (await api('/api/claude/recent')).json();
    expect(recent.find((r: any) => r.sessionId === RESUME_ID)).toMatchObject({ title: 'Earlier chat', cwd: PROJECT, openIn: null, background: false });
  });

  it('marks a conversation a Claude background session holds, and will not resume it', async () => {
    const recent = await (await api('/api/claude/recent')).json();
    expect(recent.find((r: any) => r.sessionId === HELD_ID)).toMatchObject({ background: true, openIn: null });
    const before = (await (await api('/api/m/local/sessions')).json()).length;
    const r = await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'claude', cwd: dir, resumeId: HELD_ID }) });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'background-session' });
    expect((await (await api('/api/m/local/sessions')).json()).length).toBe(before);
  });

  it('marks a recent session that is already open in workoffdesk', async () => {
    const r = await api('/api/m/local/sessions', {
      method: 'POST',
      body: JSON.stringify({ kind: 'claude', cwd: dir, resumeId: RESUME_ID, title: 'Earlier chat' }),
    });
    const s = await r.json();
    const recent = await (await api('/api/claude/recent')).json();
    expect(recent.find((r: any) => r.sessionId === RESUME_ID).openIn).toBe(s.id);
    await api(`/api/m/local/sessions/${s.id}`, { method: 'DELETE' });
  });

  it('lists a conversation by the name its session was given here, once that session has ended', async () => {
    const renamed = '0b9c2a7e-3333-4222-8333-944445555888';
    writeFileSync(join(claudeRoot, '-proj', `${renamed}.jsonl`), `${JSON.stringify({ type: 'user', cwd: PROJECT, message: { content: 'first message' } })}\n`);
    const titleOf = async () => (await (await api('/api/claude/recent')).json()).find((r: any) => r.sessionId === renamed)?.title;
    try {
      expect(await titleOf()).toBe('first message');
      const s = await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'claude', cwd: dir, resumeId: renamed, title: 'first message' }) })).json();
      await api(`/api/m/local/sessions/${s.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Login fix' }) });
      await api(`/api/m/local/sessions/${s.id}`, { method: 'DELETE' });
      expect(await titleOf()).toBe('Login fix');
    } finally {
      rmSync(join(claudeRoot, '-proj', `${renamed}.jsonl`));
    }
  });

  it('marks a conversation whose folder is gone, which cannot be picked up again', async () => {
    const here = '0b9c2a7e-4444-4222-8333-944445555999';
    // A folder outside the temporary ones, whose conversations are listed.
    writeFileSync(join(claudeRoot, '-proj', `${here}.jsonl`), `${JSON.stringify({ type: 'user', cwd: process.cwd(), message: { content: 'in a folder still there' } })}\n`);
    try {
      for (const route of ['/api/claude/recent', '/api/recent']) {
        const recent = (await (await api(route)).json()) as { sessionId: string; folderGone: boolean }[];
        expect(Object.fromEntries(recent.filter((r) => r.sessionId === RESUME_ID || r.sessionId === here).map((r) => [r.sessionId, r.folderGone]))).toEqual({ [RESUME_ID]: true, [here]: false });
      }
      const r = await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'claude', cwd: PROJECT, resumeId: RESUME_ID }) });
      expect([r.status, ((await r.json()) as { code: string }).code]).toEqual([400, 'folder-gone']);
    } finally {
      rmSync(join(claudeRoot, '-proj', `${here}.jsonl`));
    }
  });

  it('takes a conversation resumed in another folder to be there, though the one it started in is gone', async () => {
    const moved = '0b9c2a7e-5555-4222-8333-944445555aaa';
    const record = (cwd: string, content: string) => `${JSON.stringify({ type: 'user', cwd, message: { content } })}\n`;
    writeFileSync(join(claudeRoot, '-proj', `${moved}.jsonl`), record(PROJECT, 'started where it is gone') + record(process.cwd(), 'resumed here'));
    try {
      for (const route of ['/api/claude/recent', '/api/recent']) {
        const recent = (await (await api(route)).json()) as { sessionId: string; cwd: string; folderGone: boolean }[];
        expect(recent.find((r) => r.sessionId === moved)).toMatchObject({ cwd: process.cwd(), folderGone: false });
      }
    } finally {
      rmSync(join(claudeRoot, '-proj', `${moved}.jsonl`));
    }
  });

  it('offers to start in the folders of recent conversations that are still there, and every pinned one', async () => {
    const here = '0b9c2a7e-6666-4222-8333-944445555bbb';
    writeFileSync(join(claudeRoot, '-proj', `${here}.jsonl`), `${JSON.stringify({ type: 'user', cwd: process.cwd(), message: { content: 'still here' } })}\n`);
    try {
      expect(await (await api('/api/claude/projects')).json()).toEqual(['/pinned/dir', process.cwd()]);
    } finally {
      rmSync(join(claudeRoot, '-proj', `${here}.jsonl`));
    }
  });

  it('requires a login', async () => {
    expect((await api('/api/claude/recent', { headers: { cookie: 'x=y' } })).status).toBe(401);
  });
});

describe('POST /api/m/:machine/sessions/:id/continue', () => {
  it("goes on with a session's conversation in the same session, unless a background session holds it", async () => {
    const r = await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'claude', cwd: dir }) });
    const s = (await r.json()) as { id: string; claudeSessionId: string };
    const gone = await api(`/api/m/local/sessions/${s.id}/continue`, { method: 'POST' });
    expect(gone.status).toBe(200);
    expect(await gone.json()).toMatchObject({ id: s.id, claudeSessionId: s.claudeSessionId });
    store.update((st) => {
      st.sessions[s.id].claudeSessionId = HELD_ID;
    });
    const held = await api(`/api/m/local/sessions/${s.id}/continue`, { method: 'POST' });
    expect([held.status, ((await held.json()) as { code: string }).code]).toEqual([409, 'background-session']);
    expect((await api('/api/m/local/sessions/nothere0/continue', { method: 'POST' })).status).toBe(404);
    expect((await api(`/api/m/other/sessions/${s.id}/continue`, { method: 'POST' })).status).toBe(404);
    await api(`/api/m/local/sessions/${s.id}`, { method: 'DELETE' });
  });
});

describe('/api/events', () => {
  it('lists a Claude session with what Claude said last, and a shell with nothing of the kind', async () => {
    const said = '0b9c2a7e-2222-4222-8333-944445555777';
    writeFileSync(
      join(claudeRoot, '-proj', `${said}.jsonl`),
      `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '改好了，**测试全绿**。' }] } })}\n`,
    );
    const s = await (
      await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'claude', cwd: dir, resumeId: said }) })
    ).json();
    const shell = await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell', cwd: dir }) })).json();
    try {
      const ev = openWs('/api/events');
      await ev.opened;
      expect(await until(() => ev.control.some((m) => m.type === 'sessions'))).toBe(true);
      const listed = ev.control.find((m) => m.type === 'sessions').sessions;
      expect(listed.find((x: any) => x.id === s.id).lastReply).toBe('改好了，测试全绿。');
      expect(listed.find((x: any) => x.id === shell.id).lastReply).toBeNull();
      ev.ws.close();
    } finally {
      await api(`/api/m/local/sessions/${s.id}`, { method: 'DELETE' });
      await api(`/api/m/local/sessions/${shell.id}`, { method: 'DELETE' });
      rmSync(join(claudeRoot, '-proj', `${said}.jsonl`));
    }
  });
});

describe('GET /api/m/:machine/sessions/:id/commands', () => {
  it('lists what can follow a / in a Claude session, from its project and the user, and nothing for a shell', async () => {
    const shell = await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell', cwd: dir }) })).json();
    const claude = await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'claude', cwd: dir }) })).json();
    try {
      const res = await api(`/api/m/local/sessions/${claude.id}/commands`);
      expect(res.status).toBe(200);
      const { commands } = await res.json();
      expect(commands).toEqual(
        expect.arrayContaining([
          { name: 'lesson', description: '记一条经验', source: 'user' },
          { name: 'release', description: 'Cut a release', source: 'project' },
          expect.objectContaining({ name: 'compact', source: 'builtin' }),
        ]),
      );
      expect(await (await api(`/api/m/local/sessions/${shell.id}/commands`)).json()).toEqual({ commands: [] });
      expect((await api('/api/m/local/sessions/nosuch/commands')).status).toBe(404);
    } finally {
      await api(`/api/m/local/sessions/${shell.id}`, { method: 'DELETE' });
      await api(`/api/m/local/sessions/${claude.id}`, { method: 'DELETE' });
    }
  });
});

describe('GET /api/m/:machine/sessions/:id/image', () => {
  it('shows an image Claude named in the session, and nothing it did not', async () => {
    const sid = '0b9c2a7e-3333-4222-8333-944445555888';
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const named = join(dir, 'named shot.png');
    const unnamed = join(dir, 'unnamed.png');
    const deleted = join(dir, 'deleted.png');
    writeFileSync(named, png);
    writeFileSync(unnamed, png);
    writeFileSync(
      join(claudeRoot, '-proj', `${sid}.jsonl`),
      `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `截好了：${named}，还有 ${deleted}` }] } })}\n`,
    );
    const s = await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'claude', cwd: dir, resumeId: sid }) })).json();
    const shell = await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell', cwd: dir }) })).json();
    const image = (id: string, path: string) => api(`/api/m/local/sessions/${id}/image?path=${encodeURIComponent(path)}`);
    try {
      const r = await image(s.id, named);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/png');
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Buffer.from(await r.arrayBuffer())).toEqual(png);
      expect((await image(s.id, unnamed)).status).toBe(403);
      expect((await image(s.id, deleted)).status).toBe(404);
      expect((await image(shell.id, named)).status).toBe(404);
      expect((await image('nosuch', named)).status).toBe(404);
      expect((await api(`/api/m/local/sessions/${s.id}/image`)).status).toBe(400);
    } finally {
      await api(`/api/m/local/sessions/${s.id}`, { method: 'DELETE' });
      await api(`/api/m/local/sessions/${shell.id}`, { method: 'DELETE' });
      rmSync(join(claudeRoot, '-proj', `${sid}.jsonl`));
      rmSync(named);
      rmSync(unnamed);
    }
  });
});

describe('the Claude accounts', () => {
  it('says how many open sessions are on another account and will move, none before one is picked', async () => {
    expect(await (await api('/api/claude/accounts')).json()).toEqual({ accounts: [], inUse: '', picked: false, elsewhere: 0, moving: 0 });
  });

  it('refuses to move one session before an account is picked', async () => {
    const s = await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'claude', cwd: dir }) })).json();
    try {
      const r = await api(`/api/m/local/sessions/${s.id}/move`, { method: 'POST' });
      expect(r.status).toBe(409);
      expect(await r.json()).toMatchObject({ code: 'account-none-picked' });
    } finally {
      await api(`/api/m/local/sessions/${s.id}`, { method: 'DELETE' });
    }
  });

  it('refuses to move the open sessions before an account is picked', async () => {
    const r = await api('/api/claude/account/move', { method: 'POST' });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'account-none-picked' });
  });
});
