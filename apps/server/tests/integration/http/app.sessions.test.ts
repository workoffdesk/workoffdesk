import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { liveServer } from '../../helpers/server.js';
import { until } from '../../helpers/until.js';

const live = liveServer('se', { signedIn: true });
const { dir, tmux, socket: SOCKET, start, api, openWs } = live;

describe('/api/m/:machine/sessions', () => {
  let id = '';

  it('creates a shell session', async () => {
    const r = await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell', cwd: dir }) });
    expect(r.status).toBe(201);
    id = (await r.json()).id;
    const list = await (await api('/api/m/local/sessions')).json();
    expect(list.map((s: any) => s.id)).toContain(id);
  });

  it('rejects a malformed create request with 400', async () => {
    const r = await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'rocket' }) });
    expect(r.status).toBe(400);
    const r2 = await api('/api/m/local/sessions', {
      method: 'POST',
      body: JSON.stringify({ kind: 'shell', cwd: '/definitely/missing' }),
    });
    expect(r2.status).toBe(400);
  });

  // The phone shows the session as a chat: nothing attaches to it as a terminal, nothing of its screen is
  // streamed, and what is typed goes straight to the program.
  const attached = async (sid: string) => (await tmux.listSessions()).find((t) => t.name === `wod-${sid}`)?.attached;

  it('sends what is typed on the session connection to the program, with no terminal attached', async () => {
    const c = openWs(`/api/m/local/sessions/${id}/ws`);
    await c.opened;
    c.ws.send(Buffer.from('echo hello-$((1+1))\r'));
    expect(await until(async () => (await tmux.capture(`wod-${id}`, 0)).includes('hello-2'))).toBe(true);
    expect(await attached(id)).toBe(0);
    expect(c.out()).toBe('');
    c.ws.close();
    await c.closed;
  });

  it('sends typing that looks like an option to tmux as it is', async () => {
    const c = openWs(`/api/m/local/sessions/${id}/ws`);
    await c.opened;
    c.ws.send(Buffer.from('-l'));
    c.ws.send(Buffer.from(' 2>/dev/null; echo dash-$((2+2))\r'));
    expect(await until(async () => (await tmux.capture(`wod-${id}`, 0)).includes('dash-4'))).toBe(true);
    expect(await tmux.capture(`wod-${id}`, 0)).toContain('-l 2>/dev/null');
    c.ws.close();
    await c.closed;
  });

  it('opens a session at a size its panels can be read at, whatever device drew it last', async () => {
    execFileSync('tmux', ['-L', SOCKET, 'resize-window', '-t', `=wod-${id}:`, '-x', '37', '-y', '29']);
    const c = openWs(`/api/m/local/sessions/${id}/ws`);
    await c.opened;
    expect(await until(async () => (await tmux.windowSize(`wod-${id}`)).cols === 100)).toBe(true);
    expect(await tmux.windowSize(`wod-${id}`)).toEqual({ cols: 100, rows: 50 });
    // A terminal attached on the Mac still gets the window at its own size.
    expect(execFileSync('tmux', ['-L', SOCKET, 'show-options', '-wv', '-t', `=wod-${id}:`, 'window-size'], { encoding: 'utf8' }).trim()).toBe('latest');
    c.ws.close();
    await c.closed;
  });

  it('leaves the size alone while a terminal on the Mac is showing the session', async () => {
    // A control-mode client is attached as a terminal is, without needing one.
    const mac = spawn('tmux', ['-L', SOCKET, '-C', 'attach', '-t', `=wod-${id}`], { stdio: ['pipe', 'ignore', 'ignore'] });
    try {
      expect(await until(async () => (await attached(id)) === 1), 'precondition: the Mac client is attached').toBe(true);
      execFileSync('tmux', ['-L', SOCKET, 'resize-window', '-t', `=wod-${id}:`, '-x', '37', '-y', '29']);
      const c = openWs(`/api/m/local/sessions/${id}/ws`);
      await c.opened;
      await new Promise((r) => setTimeout(r, 300));
      expect(await tmux.windowSize(`wod-${id}`)).toEqual({ cols: 37, rows: 29 });
      c.ws.close();
      await c.closed;
    } finally {
      mac.kill();
    }
    expect(await until(async () => (await attached(id)) === 0)).toBe(true);
  });

  it('answers a mistake of the caller in its own words, with no trace of the inside', async () => {
    const r = await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell', cwd: '/definitely/not/here' }) });
    expect(r.status).toBe(400);
    const text = JSON.stringify(await r.json());
    expect(text).toContain('/definitely/not/here');
    expect(text).not.toMatch(/at .*\.(ts|js):\d+/);
  });

  it('answers a body that is not JSON with a 400', async () => {
    const r = await api('/api/m/local/sessions', { method: 'POST', body: '{nope' });
    expect(r.status).toBe(400);
  });

  it('starts a new session at that size', async () => {
    const sid = (await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell' }) })).json()).id;
    expect(await tmux.windowSize(`wod-${sid}`)).toEqual({ cols: 100, rows: 50 });
  });

  describe('with a choice on screen', () => {
    const SELECT = fileURLToPath(new URL('../../fixtures/select.mjs', import.meta.url));
    const choicesOf = async (id: string) => (await (await api(`/api/m/local/sessions/${id}/choices`)).json()).choices;
    const choose = (id: string, body: unknown) =>
      api(`/api/m/local/sessions/${id}/choices`, { method: 'POST', body: JSON.stringify(body) });
    const showChoice = async () => {
      const id = (await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell' }) })).json()).id;
      const c = openWs(`/api/m/local/sessions/${id}/ws`);
      await c.opened;
      c.ws.send(Buffer.from(`${process.execPath} ${SELECT} Alpha Beta Gamma\r`));
      expect(await until(async () => (await choicesOf(id))?.options.length === 3)).toBe(true);
      return { id, c };
    };
    const screen = (id: string) => tmux.capture(`wod-${id}`, 0);

    it('offers its options, and takes the one asked for', async () => {
      const { id, c } = await showChoice();
      expect(await choicesOf(id)).toEqual({
        context: 'Which one?',
        options: [{ label: 'Alpha', detail: '' }, { label: 'Beta', detail: '' }, { label: 'Gamma', detail: '' }],
        cursor: 0,
      });
      expect((await choose(id, { index: 2, label: 'Gamma' })).status).toBe(204);
      expect(await until(async () => (await screen(id)).includes('picked: Gamma'))).toBe(true);
      expect(await choicesOf(id)).toBeNull();
      c.ws.close();
      await c.closed;
    });

    it('takes it from where the cursor is now, not where it was when the options were read', async () => {
      const { id, c } = await showChoice();
      c.ws.send(Buffer.from('\x1b[B\x1b[B'));
      expect(await until(async () => (await choicesOf(id))?.cursor === 2)).toBe(true);
      expect((await choose(id, { index: 0, label: 'Alpha' })).status).toBe(204);
      expect(await until(async () => (await screen(id)).includes('picked: Alpha'))).toBe(true);
      c.ws.close();
      await c.closed;
    });

    it('reaches the program while the pane is scrolled back', async () => {
      const { id, c } = await showChoice();
      execFileSync('tmux', ['-L', SOCKET, 'copy-mode', '-t', `=wod-${id}:`]);
      expect((await choose(id, { index: 1, label: 'Beta' })).status).toBe(204);
      expect(await until(async () => (await screen(id)).includes('picked: Beta'))).toBe(true);
      c.ws.close();
      await c.closed;
    });

    it('only moves onto an answer to be typed, leaving it open for the text', async () => {
      const id = (await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell' }) })).json()).id;
      const c = openWs(`/api/m/local/sessions/${id}/ws`);
      await c.opened;
      c.ws.send(Buffer.from(`${process.execPath} ${SELECT} Alpha 'Type something.'\r`));
      expect(await until(async () => (await choicesOf(id))?.options[1]?.typed === true)).toBe(true);
      expect((await choose(id, { index: 1, label: 'Type something.' })).status).toBe(204);
      expect(await until(async () => (await choicesOf(id))?.cursor === 1)).toBe(true);
      expect(await screen(id)).not.toContain('picked:');
      c.ws.close();
      await c.closed;
    });

    it('presses nothing once the options have changed', async () => {
      const { id, c } = await showChoice();
      const r = await choose(id, { index: 1, label: 'Delta' });
      expect(r.status).toBe(409);
      await new Promise((res) => setTimeout(res, 300));
      expect(await screen(id)).not.toContain('picked:');
      expect((await choicesOf(id)).cursor).toBe(0);
      c.ws.close();
      await c.closed;
    });

    describe('with several answers', () => {
      const MULTI = fileURLToPath(new URL('../../fixtures/multiselect.mjs', import.meta.url));
      const showSeveral = async () => {
        const id = (await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell' }) })).json()).id;
        const c = openWs(`/api/m/local/sessions/${id}/ws`);
        await c.opened;
        c.ws.send(Buffer.from(`${process.execPath} ${MULTI} Lint +Types Tests\r`));
        expect(await until(async () => (await choicesOf(id))?.submit === 'Submit')).toBe(true);
        return { id, c };
      };
      const labels = ['Lint', 'Types', 'Tests', 'Type something…'];

      it('offers its ticks, and sends exactly the ones asked for', async () => {
        const { id, c } = await showSeveral();
        expect((await choicesOf(id)).options.map((o: { ticked: boolean }) => o.ticked)).toEqual([false, true, false, false]);
        expect((await choose(id, { ticked: [0, 2], labels })).status).toBe(204);
        expect(await until(async () => (await screen(id)).includes('ticked: Lint,Tests'))).toBe(true);
        c.ws.close();
        await c.closed;
      });

      it('sends it from where the cursor is now, even on Submit', async () => {
        const { id, c } = await showSeveral();
        c.ws.send(Buffer.from('\x1b[B'.repeat(4)));
        expect(await until(async () => (await choicesOf(id))?.cursor === 4)).toBe(true);
        expect((await choose(id, { ticked: [1], labels })).status).toBe(204);
        expect(await until(async () => (await screen(id)).includes('ticked: Types'))).toBe(true);
        c.ws.close();
        await c.closed;
      });

      it('presses nothing once the options have changed, or when asked to tick the answer of one\'s own', async () => {
        const { id, c } = await showSeveral();
        expect((await choose(id, { ticked: [0], labels: ['Lint', 'Types', 'Docs', 'Type something…'] })).status).toBe(409);
        expect((await choose(id, { ticked: [0], labels: [...labels, 'Docs'] })).status).toBe(409);
        expect((await choose(id, { ticked: [3], labels })).status).toBe(409);
        expect((await choose(id, { ticked: [9], labels })).status).toBe(409);
        await new Promise((res) => setTimeout(res, 300));
        expect(await screen(id)).not.toContain('ticked:');
        expect((await choicesOf(id)).options.map((o: { ticked: boolean }) => o.ticked)).toEqual([false, true, false, false]);
        c.ws.close();
        await c.closed;
      });

      it('takes no ticks for a choice of one', async () => {
        const { id, c } = await showChoice();
        expect((await choose(id, { ticked: [0], labels: ['Alpha', 'Beta', 'Gamma'] })).status).toBe(409);
        await new Promise((res) => setTimeout(res, 300));
        expect(await screen(id)).not.toContain('picked:');
        c.ws.close();
        await c.closed;
      });
    });

    describe('with a dialog open over the prompt', () => {
      const PANEL = fileURLToPath(new URL('../../fixtures/panel.mjs', import.meta.url));
      const panelOf = async (id: string) => (await (await api(`/api/m/local/sessions/${id}/choices`)).json()).panel;
      const showPanel = async () => {
        const id = (await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell' }) })).json()).id;
        const log = join(mkdtempSync(join(tmpdir(), 'panel-')), 'keys');
        writeFileSync(log, '');
        const c = openWs(`/api/m/local/sessions/${id}/ws`);
        await c.opened;
        c.ws.send(Buffer.from(`${process.execPath} ${PANEL} ${log}\r`));
        // Until it is drawn the shell's own line is up, which is not Claude's prompt either.
        expect(await until(async () => !!(await panelOf(id))?.title)).toBe(true);
        return { id, c };
      };

      it('reads it as a panel: what it is, what it shows, and its keys', async () => {
        const { id, c } = await showPanel();
        expect(await panelOf(id)).toEqual({
          title: 'Settings',
          body: '❯ Auto-compact\n    true\n  Show tips\n    true',
          hint: 'Type to filter · Esc to clear',
        });
        c.ws.close();
        await c.closed;
      });
    });

    // What the chat cannot make out, it shows as the screen's text: the phone has no terminal to look in.
    it('gives the screen as plain text, whatever is on it', async () => {
      const sid = (await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell' }) })).json()).id;
      const c = openWs(`/api/m/local/sessions/${sid}/ws`);
      await c.opened;
      c.ws.send(Buffer.from("printf '\\033[31mred-%s\\033[0m\\n' $((3+4))\r"));
      const text = async () => (await (await api(`/api/m/local/sessions/${sid}/screen`)).json()).text as string;
      expect(await until(async () => (await text()).includes('red-7'))).toBe(true);
      expect(await text()).not.toContain('\x1b');
      expect((await api('/api/m/local/sessions/nosuch/screen')).status).toBe(404);
      c.ws.close();
      await c.closed;
    });

    it('has nothing at a shell prompt, and refuses a request without an option', async () => {
      const id = (await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell' }) })).json()).id;
      expect(await choicesOf(id)).toBeNull();
      for (const body of [
        {},
        { index: -1, label: 'a' },
        { index: 1.5, label: 'a' },
        { index: 0 },
        { ticked: [0] },
        { ticked: 'all', labels: ['a'] },
        { ticked: [-1], labels: ['a'] },
        { ticked: [0.5], labels: ['a'] },
        { ticked: [0], labels: [1] },
      ]) {
        expect((await choose(id, body)).status).toBe(400);
      }
      expect((await choose('nosuch', { index: 0, label: 'a' })).status).toBe(404);
    });
  });

  // A terminal attached on the Mac may leave the pane scrolled back.
  describe('while the pane is scrolled back', () => {
    let sid = '';
    beforeAll(async () => {
      sid = (await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell' }) })).json()).id;
    });
    const inCopyMode = () =>
      execFileSync('tmux', ['-L', SOCKET, 'display-message', '-p', '-t', `=wod-${sid}:`, '#{pane_in_mode}'], { encoding: 'utf8' }).trim() === '1';

    it.each([
      ['a typed line', 'echo typed-$((2+3))\r'],
      ['a line typed one key at a time', [...'echo typed-$((2+3))\r']],
    ])('%s returns it to the live screen and reaches the program', async (_name, input) => {
      const c = openWs(`/api/m/local/sessions/${sid}/ws`);
      await c.opened;
      await tmux.sendKeys(`wod-${sid}`, 'clear');
      execFileSync('tmux', ['-L', SOCKET, 'copy-mode', '-t', `=wod-${sid}:`]);
      expect(inCopyMode()).toBe(true);
      for (const chunk of [input].flat()) c.ws.send(Buffer.from(chunk));
      expect(await until(async () => (await tmux.capture(`wod-${sid}`, 0)).includes('typed-5'))).toBe(true);
      expect(inCopyMode()).toBe(false);
      c.ws.close();
      await c.closed;
    });
  });

  it('closes with 4404 for a session that does not exist', async () => {
    const c = openWs('/api/m/local/sessions/zzzzzzzz/ws');
    expect(await c.closed).toBe(4404);
  });

  it('tells the terminal and the event stream when a session is killed outside', async () => {
    const r = await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell', cwd: dir }) });
    const victim = (await r.json()).id;
    const ev = openWs('/api/events');
    await ev.opened;
    expect(await until(() => ev.control.some((m) => m.type === 'sessions' && m.sessions.some((s: any) => s.id === victim)))).toBe(true);
    const term = openWs(`/api/m/local/sessions/${victim}/ws`);
    await term.opened;
    await tmux.killSession(`wod-${victim}`);
    expect(await until(() => term.control.some((m) => m.type === 'exit'))).toBe(true);
    expect(
      await until(() => {
        const last = ev.control.filter((m) => m.type === 'sessions').at(-1);
        return !!last && !last.sessions.some((s: any) => s.id === victim);
      }),
    ).toBe(true);
    ev.ws.close();
  });

  describe('with a name of its own', () => {
    const rename = (sid: string, body: unknown) => api(`/api/m/local/sessions/${sid}`, { method: 'PATCH', body: JSON.stringify(body) });
    const titleOf = async (sid: string) => (await (await api('/api/m/local/sessions')).json()).find((s: any) => s.id === sid)?.title;
    const dirName = dir.split('/').pop();

    it('gives it to a session for every device, which the event stream tells at once', async () => {
      const ev = openWs('/api/events');
      await ev.opened;
      const r = await rename(id, { title: '  部署\n\t修复  ' });
      expect(r.status).toBe(200);
      expect((await r.json()).title).toBe('部署 修复');
      expect(await titleOf(id)).toBe('部署 修复');
      expect(
        await until(() => ev.control.some((m) => m.type === 'sessions' && m.sessions.some((s: any) => s.id === id && s.title === '部署 修复'))),
      ).toBe(true);
      ev.ws.close();
    });

    it('refuses an empty name, and keeps the one it has', async () => {
      await rename(id, { title: '别的名字' });
      for (const title of ['', '   ', '\n\t']) expect((await rename(id, { title })).status).toBe(400);
      expect(await titleOf(id)).toBe('别的名字');
    });

    it('keeps it to a line of 40 characters, counting a Chinese character or an emoji as one', async () => {
      await rename(id, { title: `${'名'.repeat(30)}${'🙂'.repeat(20)}` });
      expect(await titleOf(id)).toBe(`${'名'.repeat(30)}${'🙂'.repeat(10)}`);
    });

    it('takes it when the session is started', async () => {
      const shell = await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell', cwd: dir, title: ' 跑测试 ' }) })).json();
      expect(shell.title).toBe('跑测试');
      const plain = await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell', cwd: dir }) })).json();
      expect(plain.title).toBe(dirName);
    });

    it('refuses it without a name, and for a session that is not there', async () => {
      for (const body of [{}, { title: 5 }, { title: null }, { title: 'x'.repeat(5000) }]) expect((await rename(id, body)).status).toBe(400);
      expect((await rename('nosuch', { title: 'a' })).status).toBe(404);
    });

    it('keeps it for the restart below', async () => {
      expect((await rename(id, { title: '主会话' })).status).toBe(200);
    });
  });

  it('keeps sessions across a server restart', async () => {
    await live.server.close();
    live.server = await start();
    const list = await (await api('/api/m/local/sessions')).json();
    expect(list.map((s: any) => s.id)).toContain(id);
    expect(list.find((s: any) => s.id === id).title).toBe('主会话');
    const c = openWs(`/api/m/local/sessions/${id}/ws`);
    await c.opened;
    c.ws.send(Buffer.from('echo after-$((1+2))\r'));
    expect(await until(async () => (await tmux.capture(`wod-${id}`, 50)).includes('after-3'))).toBe(true);
    c.ws.close();
  });

  it('deletes a session', async () => {
    expect((await api(`/api/m/local/sessions/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await tmux.hasSession(`wod-${id}`)).toBe(false);
  });
});

// What the composer sends: to the program now, or held while Claude cannot take it (see machine.test).
describe('POST /api/m/:machine/sessions/:id/messages', () => {
  const screenOf = async (sid: string) => (await (await api(`/api/m/local/sessions/${sid}/screen`)).json()).text as string;
  const post = (sid: string, body: unknown) =>
    api(`/api/m/local/sessions/${sid}/messages`, { method: 'POST', body: JSON.stringify(body) });

  it('sends them to the program as typed lines, and says they were not held', async () => {
    const sid = (await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell', cwd: dir }) })).json()).id;
    const r = await post(sid, { text: 'echo "msg-$((6*7))"' });
    expect(r.status).toBe(200);
    // Not held, and the journal's row for it, which the page shows in place of its own copy.
    expect(await r.json()).toMatchObject({ queued: null, message: { body: { text: 'echo "msg-$((6*7))"' } } });
    expect(await until(async () => (await screenOf(sid)).includes('msg-42'))).toBe(true);
    await api(`/api/m/local/sessions/${sid}`, { method: 'DELETE' });
  });

  it('takes one sent again under the id the page gave it once', async () => {
    const sid = (await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell', cwd: dir }) })).json()).id;
    for (let i = 0; i < 2; i++) expect((await post(sid, { text: 'echo "once-$((5*5))"', id: 'page0000001' })).status).toBe(200);
    expect(await until(async () => (await screenOf(sid)).includes('once-25'))).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    expect((await screenOf(sid)).match(/once-25/g)).toHaveLength(1);
    for (const id of [5, '', 'x', 'has space!', 'y'.repeat(65)]) expect((await post(sid, { text: 'hi', id })).status, String(id)).toBe(400);
    await api(`/api/m/local/sessions/${sid}`, { method: 'DELETE' });
  });

  it('refuses one without text, and one for no session', async () => {
    const sid = (await (await api('/api/m/local/sessions', { method: 'POST', body: JSON.stringify({ kind: 'shell', cwd: dir }) })).json()).id;
    for (const body of [{}, { text: '' }, { text: 5 }]) expect((await post(sid, body)).status, JSON.stringify(body)).toBe(400);
    expect((await post(sid, { text: 'x'.repeat(70_000) })).status).toBe(413);
    expect((await post('nosuch', { text: 'hi' })).status).toBe(404);
    expect((await api(`/api/m/local/sessions/${sid}/messages/0123456789ab`, { method: 'DELETE' })).status).toBe(404);
    await api(`/api/m/local/sessions/${sid}`, { method: 'DELETE' });
  });
});
