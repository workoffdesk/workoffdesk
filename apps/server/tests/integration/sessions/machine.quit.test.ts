import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { writeClaudeSettings } from '../../../src/agents/claude/hooks/hooks.js';
import { LocalMachine } from '../../../src/sessions/machine.js';
import { Store } from '../../../src/system/store.js';
import { Tmux } from '../../../src/system/tmux.js';
import { RUNS, machineSetup, realClaude } from '../../helpers/machine.js';
import { until } from '../../helpers/until.js';

const { dir, tmux, conf, argsFile, startsFile, make, restarted } = machineSetup('quit');

describe('LocalMachine', () => {
  describe('a session whose Claude quit', () => {
    // Claude as a shell at its prompt, which what is sent to it runs, and `exit` quits.
    const AS_SHELL = ['--run', 'exec /bin/sh'];
    const running = async (o: { claudeArgs?: string[]; claudeProjectsRoot?: string } = {}) => {
      const made = make({ claudeArgs: AS_SHELL, ...o });
      const s = await made.m.createSession({ kind: 'claude', cwd: dir });
      expect(await until(async () => childrenOf(await panePid(s.id)).length === 1)).toBe(true);
      // What SessionStart says of a real Claude.
      made.m.setStatus(s.id, 'idle');
      return { ...made, id: s.id, sid: s.claudeSessionId! };
    };
    const statusOf = async (m: LocalMachine, id: string) => (await m.listSessions()).find((s) => s.id === id)?.status;
    const panePid = async (id: string) => (await tmux.listSessions()).find((t) => t.name === `wod-${id}`)!.panePid!;
    const childrenOf = (pid: number) => {
      try {
        return execFileSync('pgrep', ['-P', String(pid)]).toString().trim().split('\n').map(Number);
      } catch {
        return [];
      }
    };
    const startsIn = (id: string) => (existsSync(startsFile) ? readFileSync(startsFile, 'utf8').split('\n').filter((l) => l === id).length : 0);
    // A Claude killed is a program, as the real one is: a shell killed leaves the terminal to a process group
    // that is gone, and the shell after it is not hung up with the terminal.
    const ways: [string, string[], (m: LocalMachine, id: string) => Promise<void>][] = [
      ['quits at its prompt', AS_SHELL, (m, id) => m.type(id, 'exit\r')],
      ['is killed', RUNS, async (_m, id) => void process.kill(childrenOf(await panePid(id))[0], 'SIGKILL')],
    ];
    const quit = async (m: LocalMachine, id: string, how = ways[0][2]) => {
      const pane = await panePid(id);
      expect(childrenOf(pane)).toHaveLength(1);
      await how(m, id);
      expect(await until(() => childrenOf(pane).length === 0)).toBe(true);
    };

    it.each(ways)('ends the session of a Claude that %s, with no hook to say so', async (_name, claudeArgs, how) => {
      const { m, id } = await running({ claudeArgs });
      await quit(m, id, how);
      expect(await until(async () => (await statusOf(m, id)) === 'ended')).toBe(true);
    });

    it.each(ways)('sends nothing into the shell left behind once Claude %s, before a listing has seen it too', async (_name, claudeArgs, how) => {
      const { m, id } = await running({ claudeArgs });
      await quit(m, id, how);
      expect(await m.sendMessage(id, 'echo LEAKED-$((40+2))')).not.toBeNull();
      await new Promise((r) => setTimeout(r, 500));
      expect(await m.screenText(id)).not.toContain('LEAKED');
      expect(m.getStatus(id)).toBe('ended');
    });

    it('is ended after a restart, not taken for Claude idle at its prompt', async () => {
      const { m, store, id } = await running();
      await quit(m, id);
      expect(await statusOf(restarted(store), id)).toBe('ended');
    });

    it('is told apart from one whose Claude still runs, whatever said it ended', async () => {
      const { m, id } = await running();
      m.setStatus(id, 'ended');
      expect(await until(async () => (await statusOf(m, id)) === 'idle')).toBe(true);
      m.claudeMayHaveQuit(id);
      await new Promise((r) => setTimeout(r, 500));
      expect(m.getStatus(id)).toBe('idle');
    });

    it.each([
      ['with nothing said yet starts its conversation under the same id', false, '--session-id'],
      ['goes on with its conversation', true, '--resume'],
    ])('%s, in the same session', async (_name, said, flag) => {
      const projects = mkdtempSync(join(dir, 'projects-'));
      const { m, id, sid } = await running({ claudeProjectsRoot: projects });
      if (said) {
        mkdirSync(join(projects, 'p'));
        writeFileSync(join(projects, 'p', `${sid}.jsonl`), '');
      }
      await quit(m, id);
      writeFileSync(argsFile, '');
      const s = await m.continueSession(id);
      expect(s).toMatchObject({ id, claudeSessionId: sid, status: 'starting' });
      expect(await until(() => readFileSync(argsFile, 'utf8').includes('env='))).toBe(true);
      const args = readFileSync(argsFile, 'utf8').trim().split('\n');
      expect(args.slice(0, 4)).toEqual([flag, sid, '--settings', '/tmp/term site/claude settings.json']);
      expect(args).toContain(`env=${id}`);
      expect(args).toContain('alt=1');
      expect((await m.listSessions()).filter((x) => x.claudeSessionId === sid).map((x) => x.id)).toEqual([id]);
    });

    it('sends what waited once Claude says it started', async () => {
      const { m, id } = await running();
      await quit(m, id);
      expect(await m.sendMessage(id, 'echo WENT-$((40+2))')).not.toBeNull();
      await m.continueSession(id);
      expect(await until(async () => childrenOf(await panePid(id)).length === 1)).toBe(true);
      await new Promise((r) => setTimeout(r, 300));
      expect(await m.screenText(id)).not.toContain('WENT-42');
      m.setStatus(id, 'idle');
      expect(await until(async () => (await m.screenText(id)).includes('WENT-42'))).toBe(true);
      expect(m.journal.messages(id).filter((q) => q.state === 'queued')).toEqual([]);
    });

    it('starts one Claude when asked twice at once', async () => {
      const { m, id } = await running();
      await quit(m, id);
      const both = await Promise.all([m.continueSession(id), m.continueSession(id)]);
      expect(both.map((s) => s.id)).toEqual([id, id]);
      expect(await until(() => startsIn(id) === 2)).toBe(true);
      await new Promise((r) => setTimeout(r, 500));
      expect(startsIn(id)).toBe(2);
    });

    it('leaves a Claude that runs as it is', async () => {
      const { m, id } = await running();
      expect((await m.continueSession(id)).id).toBe(id);
      await new Promise((r) => setTimeout(r, 500));
      expect(startsIn(id)).toBe(1);
      expect(m.getStatus(id)).toBe('idle');
    });

    it('is refused while something runs in the shell left behind', async () => {
      const { m, id } = await running();
      await quit(m, id);
      await m.type(id, 'sleep 30\r');
      expect(await until(async () => childrenOf(await panePid(id)).length === 1)).toBe(true);
      await expect(m.continueSession(id)).rejects.toMatchObject({ status: 409, code: 'terminal-busy' });
      await m.type(id, '\x03');
      expect(startsIn(id)).toBe(1);
    });

    it('is gone on with by a resume of its conversation, rather than a second session', async () => {
      const { m, id, sid } = await running();
      await quit(m, id);
      const s = await m.createSession({ kind: 'claude', cwd: dir, resumeId: sid });
      expect(s.id).toBe(id);
      expect(await until(() => startsIn(id) === 2)).toBe(true);
    });

    it('is ended again when Claude quits as soon as it is started', async () => {
      const { m } = make();
      const s = await m.createSession({ kind: 'claude', cwd: dir });
      expect(await until(async () => (await statusOf(m, s.id)) === 'ended')).toBe(true);
      expect((await m.continueSession(s.id)).status).toBe('starting');
      expect(await until(() => startsIn(s.id) === 2)).toBe(true);
      expect(await until(async () => (await statusOf(m, s.id)) === 'ended')).toBe(true);
    });

    it.each([
      ['a shell session', async (m: LocalMachine) => (await m.createSession({ kind: 'shell', cwd: dir })).id, 400],
      ['a session the Mac does not have', async () => 'aaaaaaaaaaaa', 404],
      ['what is no session id', async () => '../x', 400],
    ])('refuses %s', async (_name, idOf, status) => {
      const { m } = make();
      await expect(m.continueSession(await idOf(m))).rejects.toMatchObject({ status });
    });
  });

  // Pins the outside behaviour reading tall dialogs depends on: if Claude Code stops honouring the switch,
  // this goes red here instead of the panels' scrolled-off lines silently going missing on the phone.
  describe.skipIf(!realClaude)('with the real claude, started the way workoffdesk starts it', () => {
    // Claude needs its own settings and login under the real home; it only reads them here.
    const tmux = new Tmux({ socket: `workoffdesk-test-real-${process.pid}`, conf, env: { ...process.env, HOME: process.env.TEST_REAL_HOME } });
    afterAll(() => tmux.killServer());

    it('stays out of the alternate screen, where by default it goes', async () => {
      const cwd = process.cwd();
      await tmux.newSession('plain-claude', { cwd, env: {}, command: `${realClaude}` });
      expect(await until(async () => await tmux.alternateOn('plain-claude'), 30_000), 'precondition: claude normally enters the alternate screen').toBe(true);
      await tmux.killSession('plain-claude');

      const settings = join(dir, 'settings.json');
      writeFileSync(settings, '{}');
      const m = new LocalMachine({ tmux, store: new Store(join(mkdtempSync(join(dir, 's-')), 'state.json')), claudeSettingsPath: settings, claudeBin: realClaude!, shell: '/bin/zsh' });
      const s = await m.createSession({ kind: 'claude', cwd });
      const plain = async () => (await tmux.capture(`wod-${s.id}`, 50)).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
      await until(async () => (await plain()).includes('Claude Code'), 30_000);
      await new Promise((r) => setTimeout(r, 3000));
      expect(await plain()).toContain('Claude Code');
      expect(await tmux.alternateOn(`wod-${s.id}`)).toBe(false);
      await m.killSession(s.id);
    }, 90_000);

    // A Claude with agent view moves its conversation to a background session of its own (on quitting, or by
    // /background) and turns the window into a list; what the phone types then starts new sessions there.
    it('has no agent view under the settings workoffdesk gives it', async () => {
      const agents = (settings: string) =>
        new Promise<string>((resolve) =>
          execFile(realClaude!, ['--settings', settings, 'agents', '--json'], { env: { ...process.env, HOME: process.env.TEST_REAL_HOME }, timeout: 20_000 }, (_e, out, err) => resolve(`${out}${err}`)),
        );
      const plain = join(dir, 'plain-settings.json');
      writeFileSync(plain, '{}');
      expect(await agents(plain), 'precondition: claude has agent view by default').toMatch(/^\s*\[/);
      const ours = join(dir, 'claude-settings.json');
      writeClaudeSettings(ours, join(dir, 'hooks.sock'));
      expect(await agents(ours)).toContain('is disabled by the');
    }, 60_000);
  });
});
