import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LocalMachine, SCREEN_HISTORY } from '../../../src/sessions/machine.js';
import { Store } from '../../../src/system/store.js';
import { Tmux } from '../../../src/system/tmux.js';
import { RUNS, machineSetup } from '../../helpers/machine.js';
import { until } from '../../helpers/until.js';

const { dir, tmux, conf, argsFile, fakeClaude, make } = machineSetup('m');

describe('LocalMachine', () => {
  // What the chat page reads every second: a tmux that never answers fails the reading, so the next one runs.
  it('gives up reading a screen when tmux does not answer', async () => {
    const bin = join(dir, 'tmux-stuck');
    writeFileSync(bin, '#!/bin/sh\nexec sleep 600\n');
    chmodSync(bin, 0o755);
    const stuck = new Tmux({ socket: `workoffdesk-stuck-m-${process.pid}`, conf, bin, timeoutMs: 300 });
    const m = new LocalMachine({ tmux: stuck, store: new Store(join(mkdtempSync(join(dir, 's-')), 'state.json')), claudeSettingsPath: '/dev/null', shell: '/bin/sh' });
    const start = Date.now();
    await expect(m.onScreen('abc')).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  it('creates a shell session titled after its cwd and lists it', async () => {
    const { m } = make();
    const sub = join(dir, 'my-project');
    mkdirSync(sub);
    const s = await m.createSession({ kind: 'shell', cwd: sub });
    expect(s.id).toMatch(/^[a-z0-9]{8}$/);
    expect(s.title).toBe('my-project');
    expect(s.status).toBeNull();
    expect((await m.listSessions()).map((x) => x.id)).toContain(s.id);
  });

  it('reads the screen with what scrolled off above it, up to a phone-sized history', async () => {
    const { m } = make();
    const s = await m.createSession({ kind: 'shell', cwd: dir });
    await m.type(s.id, 'seq -f "line-%g" 1 1000\r');
    expect(await until(async () => (await m.screenText(s.id)).includes('line-1000'))).toBe(true);
    const lines = (await m.screenText(s.id)).split('\n');
    const height = (await tmux.screen(`wod-${s.id}`)).replace(/\n$/, '').split('\n').length;
    expect(lines.length).toBeGreaterThan(height);
    expect(lines).toContain(`line-${1000 - height}`);
    expect(lines).not.toContain('line-1');
    expect(lines.length).toBeLessThanOrEqual(SCREEN_HISTORY + height);
  });

  it('drops a session killed outside workoffdesk from the list and the store', async () => {
    const { m, store } = make();
    const s = await m.createSession({ kind: 'shell', cwd: dir });
    await tmux.killSession(`wod-${s.id}`);
    expect((await m.listSessions()).map((x) => x.id)).not.toContain(s.id);
    expect(store.get().sessions[s.id]).toBeUndefined();
  });

  it('adopts a wod- session that exists in tmux but not in the store', async () => {
    const { m } = make();
    await tmux.newSession('wod-orphan01', { cwd: dir, env: {} });
    const s = (await m.listSessions()).find((x) => x.id === 'orphan01');
    expect(s?.kind).toBe('shell');
  });

  it('reports every timestamp in epoch milliseconds, adopted sessions included', async () => {
    const { m } = make();
    const before = Date.now();
    const made = await m.createSession({ kind: 'shell', cwd: dir });
    await tmux.newSession('wod-orphan02', { cwd: dir, env: {} });
    const list = (await m.listSessions()).filter((x) => x.id === made.id || x.id === 'orphan02');
    expect(list).toHaveLength(2);
    // tmux keeps whole seconds, so allow the floor of the current second.
    for (const s of [made, ...list]) {
      for (const t of [s.createdAt, s.lastActivity]) {
        expect(t, `${s.id}: ${t}`).toBeGreaterThanOrEqual(before - 1000);
        expect(t, `${s.id}: ${t}`).toBeLessThanOrEqual(Date.now() + 1000);
      }
    }
  });

  // A listing races every create; metadata may only be pruned when a tmux
  // listing that began after the metadata was written no longer has the session.
  describe('when a listing overlaps a create', () => {
    const gate = () => {
      let open!: () => void;
      const opened = new Promise<void>((r) => (open = r));
      return { open, opened };
    };
    const gated = (hold: 'newSession' | 'listSessions') => {
      const g = gate();
      const entered = gate();
      const t = new Tmux({ socket: `workoffdesk-test-m-${process.pid}-${Date.now()}`, conf });
      const real = { newSession: t.newSession.bind(t), listSessions: t.listSessions.bind(t) };
      let armed = true;
      t.newSession = async (...a) => {
        if (hold === 'newSession' && armed) {
          entered.open();
          await g.opened;
        }
        return real.newSession(...a);
      };
      t.listSessions = async () => {
        const result = await real.listSessions();
        if (hold === 'listSessions' && armed) {
          armed = false;
          entered.open();
          await g.opened;
        }
        return result;
      };
      const store = new Store(join(mkdtempSync(join(dir, 's-')), 'state.json'));
      const m = new LocalMachine({ tmux: t, store, claudeSettingsPath: '/dev/null', claudeBin: fakeClaude, claudeArgs: RUNS, shell: '/bin/sh' });
      return { m, store, t, release: g.open, entered: entered.opened };
    };

    it('keeps the new session when the listing runs while tmux is still creating it', async () => {
      const { m, store, t, release, entered } = gated('newSession');
      try {
        const creating = m.createSession({ kind: 'claude', cwd: dir, title: 'racer' });
        await entered;
        await m.listSessions();
        release();
        const s = await creating;
        const listed = (await m.listSessions()).find((x) => x.id === s.id);
        expect(listed?.title).toBe('racer');
        expect(listed?.kind).toBe('claude');
        expect(store.get().sessions[s.id]).toBeDefined();
      } finally {
        await t.killServer();
      }
    });

    it('keeps the new session when the listing read tmux before the create finished', async () => {
      const { m, store, t, release, entered } = gated('listSessions');
      try {
        await t.newSession('ts-keepalv0', { cwd: dir, env: {} });
        const listing = m.listSessions();
        await entered;
        const s = await m.createSession({ kind: 'claude', cwd: dir, title: 'racer' });
        release();
        await listing;
        const listed = (await m.listSessions()).find((x) => x.id === s.id);
        expect(listed?.title).toBe('racer');
        expect(store.get().sessions[s.id]).toBeDefined();
        expect(m.getStatus(s.id)).toBe('starting');
      } finally {
        await t.killServer();
      }
    });
  });

  it('ignores tmux sessions without the ts- prefix', async () => {
    const { m } = make();
    await tmux.newSession('mine', { cwd: dir, env: {} });
    expect((await m.listSessions()).map((x) => x.id)).not.toContain('mine');
  });

  it('starts claude with a fresh session id, our settings file, the term session env, and no arguments of its own', async () => {
    const { m } = make();
    writeFileSync(argsFile, '');
    const s = await m.createSession({ kind: 'claude', cwd: dir });
    expect(await until(() => existsSync(argsFile) && readFileSync(argsFile, 'utf8').includes('env='))).toBe(true);
    const args = readFileSync(argsFile, 'utf8').trim().split('\n');
    expect(args.slice(0, 5)).toEqual(['--session-id', s.claudeSessionId, '--settings', '/tmp/term site/claude settings.json', 'alt=1']);
    expect(s.claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(args).toContain(`env=${s.id}`);
  });

  it('gives a new Claude session as starting, until Claude says it has started', async () => {
    const { m } = make({ claudeArgs: RUNS });
    const s = await m.createSession({ kind: 'claude', cwd: dir });
    expect(s.status).toBe('starting');
    expect(m.getStatus(s.id)).toBe('starting');
  });

  it('starts claude with the arguments the config names, each passed as it is written', async () => {
    const { m } = make({ claudeArgs: ['--chrome', '--append-system-prompt', "it's a b"] });
    writeFileSync(argsFile, '');
    const s = await m.createSession({ kind: 'claude', cwd: dir });
    expect(await until(() => readFileSync(argsFile, 'utf8').includes('env='))).toBe(true);
    const args = readFileSync(argsFile, 'utf8').trim().split('\n');
    expect(args.slice(0, 7)).toEqual([
      '--session-id', s.claudeSessionId, '--settings', '/tmp/term site/claude settings.json',
      '--chrome', '--append-system-prompt', "it's a b",
    ]);
  });

  it('resumes claude with --resume and keeps the resumed id', async () => {
    const { m } = make({ claudeArgs: ['--chrome'] });
    writeFileSync(argsFile, '');
    const rid = '11111111-2222-3333-4444-555555555555';
    const s = await m.createSession({ kind: 'claude', cwd: dir, resumeId: rid, title: 'Old chat' });
    expect(await until(() => readFileSync(argsFile, 'utf8').includes('env='))).toBe(true);
    const args = readFileSync(argsFile, 'utf8').trim().split('\n');
    expect(args.slice(0, 2)).toEqual(['--resume', rid]);
    expect(args).toContain('--chrome');
    expect(s.claudeSessionId).toBe(rid);
    // Called what Claude calls the conversation, once it is read; the list's title for it is not a name given here.
    expect(s.title).toBe(basename(dir));
  });

  it('survives a cwd with spaces and quotes', async () => {
    const { m } = make();
    const odd = join(dir, `it's "odd" $(touch pwned)`);
    mkdirSync(odd);
    const s = await m.createSession({ kind: 'claude', cwd: odd });
    expect((await m.listSessions()).map((x) => x.id)).toContain(s.id);
    expect(existsSync(join(odd, 'pwned'))).toBe(false);
    expect(existsSync(join(dir, 'pwned'))).toBe(false);
  });

  it('rejects a resume id that is not a uuid', async () => {
    const { m } = make();
    await expect(m.createSession({ kind: 'claude', cwd: dir, resumeId: 'x; rm -rf ~' })).rejects.toThrow(/resume/);
  });

  it('starts in a folder written from home with ~/', async () => {
    const { m } = make();
    const sub = join(homedir(), 'from-home');
    mkdirSync(sub, { recursive: true });
    const s = await m.createSession({ kind: 'shell', cwd: '~/from-home' });
    expect(s.cwd).toBe(sub);
    expect(s.title).toBe('from-home');
  });

  it.each([
    ['a new session', { kind: 'shell' as const }],
    ['a Claude conversation gone on with', { kind: 'claude' as const, resumeId: '0199bbbb-0000-7000-8000-00000000000a' }],
  ])('says the folder of %s is gone when it is not a directory', async (_, spec) => {
    const { m } = make();
    await expect(m.createSession({ ...spec, cwd: join(dir, 'nope') })).rejects.toMatchObject({ status: 400, code: 'folder-gone' });
  });

  it('notifies on create, kill and status change', async () => {
    const { m } = make({ claudeArgs: RUNS });
    let n = 0;
    const off = m.onChange(() => n++);
    const s = await m.createSession({ kind: 'claude', cwd: dir });
    expect(n).toBe(1);
    m.setStatus(s.id, 'working');
    expect(n).toBe(2);
    expect((await m.listSessions()).find((x) => x.id === s.id)?.status).toBe('working');
    await m.killSession(s.id);
    expect(n).toBe(3);
    off();
    await m.createSession({ kind: 'shell', cwd: dir });
    expect(n).toBe(3);
  });

  it('notices, as it watches, a session ending outside workoffdesk', async () => {
    const { m } = make();
    const s = await m.createSession({ kind: 'shell', cwd: dir });
    let n = 0;
    m.onChange(() => n++);
    const stop = m.watch(100);
    await tmux.killSession(`wod-${s.id}`);
    expect(await until(() => n > 0, 3000)).toBe(true);
    stop();
  });

  // Whoever lists the sessions first is the one that sees one gone; the change is not lost to the others.
  it('tells of a session ending outside workoffdesk whichever listing sees it first', async () => {
    const { m } = make();
    const s = await m.createSession({ kind: 'shell', cwd: dir });
    await m.listSessions();
    let n = 0;
    m.onChange(() => n++);
    await tmux.killSession(`wod-${s.id}`);
    expect((await m.listSessions()).map((t) => t.id)).not.toContain(s.id);
    expect(n).toBe(1);
    await m.listSessions();
    expect(n).toBe(1);
  });

  // Claude Code draws in the alternate screen unless told not to, and then its whole conversation
  // lives only inside it. Every program started in a workoffdesk session gets told.
  it.each(['shell', 'claude'] as const)('tells programs in a %s session to stay out of the alternate screen', async (kind) => {
    const { m } = make();
    writeFileSync(argsFile, '');
    const s = await m.createSession({ kind, cwd: dir });
    if (kind === 'shell') await tmux.sendKeys(`wod-${s.id}`, 'echo "alt=$CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN"');
    const seen = async () =>
      kind === 'shell' ? await tmux.capture(`wod-${s.id}`, 100) : readFileSync(argsFile, 'utf8');
    expect(await until(async () => /alt=1\b/.test(await seen()))).toBe(true);
  });

  // What a Claude conversation is called in the list of those on this Mac: the name the user gave the session
  // it was in, after that session has ended too.
  describe('the name a Claude conversation was given', () => {
    const RESUMED = '0a0a0a0a-1111-4222-8333-944445555666';
    const NEXT = '0a0a0a0a-1111-4222-8333-944445555777';
    const named = async (m: LocalMachine, title = 'Fix the login') => {
      const s = await m.createSession({ kind: 'claude', cwd: dir });
      expect(await m.renameSession(s.id, title)).not.toBeNull();
      return s;
    };

    it.each([
      ['ended here', (m: LocalMachine, id: string) => m.killSession(id)],
      ['ended outside', async (m: LocalMachine, id: string) => {
        await tmux.killSession(`wod-${id}`);
        await m.listSessions();
      }],
    ])('is kept for the conversation once its session has %s', async (_, end) => {
      const { m, store } = make();
      const s = await named(m);
      await end(m, s.id);
      expect(store.get().sessions[s.id]).toBeUndefined();
      expect(m.claudeName(s.claudeSessionId!)).toBe('Fix the login');
    });

    it('is the name given last, in a later session that picked the conversation up again too', async () => {
      const { m } = make();
      const s = await named(m);
      await m.renameSession(s.id, 'Second name');
      expect(m.claudeName(s.claudeSessionId!)).toBe('Second name');
      await m.killSession(s.id);
      const again = await m.createSession({ kind: 'claude', cwd: dir, resumeId: s.claudeSessionId, title: 'Second name' });
      expect(m.claudeName(s.claudeSessionId!)).toBe('Second name');
      await m.renameSession(again.id, 'Third name');
      await m.killSession(again.id);
      expect(m.claudeName(s.claudeSessionId!)).toBe('Third name');
    });

    it('is gone when the name is cleared, so the conversation goes by its own title again', async () => {
      const { m } = make();
      const s = await named(m);
      await m.renameSession(s.id, '   ');
      expect(m.claudeName(s.claudeSessionId!)).toBeNull();
    });

    it('is not a title the session was started with, nor its directory name', async () => {
      const { m } = make();
      const resumed = await m.createSession({ kind: 'claude', cwd: dir, resumeId: RESUMED, title: 'first message of it' });
      const plain = await m.createSession({ kind: 'claude', cwd: dir });
      expect(m.claudeName(RESUMED)).toBeNull();
      expect(m.claudeName(plain.claudeSessionId!)).toBeNull();
      expect(resumed.title).toBe(basename(dir));
    });

    it('goes with the session into the next conversation it holds, and stays with the one before', async () => {
      const { m } = make();
      const s = await named(m);
      m.setClaudeSessionId(s.id, NEXT);
      expect(m.claudeName(NEXT)).toBe('Fix the login');
      expect(m.claudeName(s.claudeSessionId!)).toBe('Fix the login');
    });

    it('is kept across a restart', async () => {
      const { m, store } = make();
      const s = await named(m);
      await m.killSession(s.id);
      const after = new LocalMachine({ tmux, store, claudeSettingsPath: '/dev/null', shell: '/bin/sh' });
      expect(after.claudeName(s.claudeSessionId!)).toBe('Fix the login');
    });

    it('is kept for the latest 200 conversations named, not without end', async () => {
      const { m, store } = make();
      const s = await named(m);
      const first = s.claudeSessionId!;
      const ids = Array.from({ length: 200 }, (_, i) => `0a0a0a0a-1111-4222-8333-${String(i).padStart(12, '0')}`);
      for (const id of ids) m.setClaudeSessionId(s.id, id);
      expect(Object.keys(store.get().claudeNames)).toHaveLength(200);
      expect(m.claudeName(first)).toBeNull();
      expect(m.claudeName(ids[0])).toBe('Fix the login');
      expect(m.claudeName(ids[199])).toBe('Fix the login');
      // Named again, the oldest becomes the latest, and the next oldest goes in its place.
      m.setClaudeSessionId(s.id, ids[0]);
      m.setClaudeSessionId(s.id, NEXT);
      expect(m.claudeName(ids[0])).toBe('Fix the login');
      expect(m.claudeName(ids[1])).toBeNull();
    });

    it('is not kept for a shell session, which holds no conversation', async () => {
      const { m, store } = make();
      const s = await m.createSession({ kind: 'shell', cwd: dir });
      await m.renameSession(s.id, 'Build');
      expect(store.get().claudeNames).toEqual({});
    });
  });

  describe('after a restart', () => {
    const SELECT = fileURLToPath(new URL('../../fixtures/select.mjs', import.meta.url));
    const PANEL = fileURLToPath(new URL('../../fixtures/panel.mjs', import.meta.url));
    // A claude session whose Claude shows what `command` does, and a second machine on the same tmux and store:
    // the server after a restart, knowing no statuses. `reads` is the tmux the second one reads through.
    const showing = async (command: string | null, reads: Tmux = tmux) => {
      const { m, store } = make({ claudeArgs: command ? ['--run', command] : RUNS });
      const s = await m.createSession({ kind: 'claude', cwd: dir });
      if (command) {
        expect(await until(async () => (await m.onScreen(s.id)).choices !== null || (await m.onScreen(s.id)).panel !== null)).toBe(true);
      }
      const again = new LocalMachine({ tmux: reads, store, claudeSettingsPath: '/dev/null', shell: '/bin/sh' });
      return { id: s.id, again };
    };
    const statusIn = async (m: LocalMachine, id: string) => (await m.listSessions()).find((s) => s.id === id)?.status;

    it('remembers that a session is waiting for a choice', async () => {
      const { id, again } = await showing(`${process.execPath} ${SELECT} Alpha Beta`);
      expect(await until(async () => (await statusIn(again, id)) === 'waiting')).toBe(true);
    });

    // The usage tab: a dialog with nothing in it to pick, so only the dialog says Claude is waiting.
    it('remembers that a session has a dialog open', async () => {
      const { id, again } = await showing(`${process.execPath} ${PANEL} ${join(dir, 'panel-keys.log')} usage`);
      expect((await again.onScreen(id)).choices).toBeNull();
      expect(await until(async () => (await statusIn(again, id)) === 'waiting')).toBe(true);
    });

    it('takes a session with nothing asked on screen as idle', async () => {
      const { id, again } = await showing(null);
      await again.listSessions();
      await new Promise((r) => setTimeout(r, 500));
      expect(again.getStatus(id)).toBe('idle');
    });

    it('lets a hook that arrives during the screen read win', async () => {
      let during = false;
      const reads: Tmux = Object.create(tmux);
      reads.screenAndAbove = async (name, lines) => {
        const seen = await tmux.screenAndAbove(name, lines);
        again.setStatus(id, 'working');
        during = true;
        return seen;
      };
      const { id, again } = await showing(`${process.execPath} ${SELECT} Alpha Beta`, reads);
      await again.listSessions();
      expect(await until(() => during)).toBe(true);
      await new Promise((r) => setTimeout(r, 200));
      expect(again.getStatus(id)).toBe('working');
    });
  });

});
