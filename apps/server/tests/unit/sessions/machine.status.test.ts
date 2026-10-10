import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { LocalMachine } from '../../../src/sessions/machine.js';
import { Store } from '../../../src/system/store.js';
import type { Tmux } from '../../../src/system/tmux.js';

const AT_PROMPT = readFileSync(new URL('../../fixtures/screens/idle-after-answer.txt', import.meta.url), 'utf8');
const SID = '11111111-2222-3333-4444-555555555555';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const prompt = (at: string) => JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: 'do it' } });
const toolUse = (at: string) => JSON.stringify({ type: 'assistant', timestamp: at, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } });
const stopped = (at: string) => JSON.stringify({ type: 'system', subtype: 'stop_hook_summary', timestamp: at });
const interrupted = (at: string) =>
  JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });

// The process a Claude session's pane starts with, which waits for Claude: it runs while this does.
const claudePane = spawn('/bin/sh', ['-lc', 'sleep 600; exit'], { stdio: 'ignore', detached: true });
afterAll(() => process.kill(-claudePane.pid!));

// A Mac whose Claude session shows its prompt on screen (as it does between calls too), with its transcript
// written as given; what is pasted into it is recorded.
function setup(transcript: string[] | null, queued: { id: string; text: string; at: number }[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'ts-turn-'));
  const root = join(dir, 'projects');
  mkdirSync(join(root, '-x'), { recursive: true });
  if (transcript) writeFileSync(join(root, '-x', `${SID}.jsonl`), transcript.join('\n') + '\n');
  const store = new Store(join(dir, 'state.json'));
  store.update((s) => {
    s.sessions.abc = { title: 'proj', kind: 'claude', cwd: '/x', claudeSessionId: SID, createdAt: 1 };
  });
  const pasted: string[] = [];
  const unread = async () => {
    throw new Error('not read in these tests');
  };
  const tmux = {
    listSessions: async () => [{ name: 'wod-abc', created: 1, activity: 1, attached: 0, panePid: claudePane.pid }],
    panePid: async () => claudePane.pid,
    screenAndAbove: async () => ({ screen: AT_PROMPT, above: '' }),
    screenStyled: unread,
    screenJoined: unread,
    windowSize: unread,
    leaveCopyMode: async () => {},
    paste: async (_name: string, text: string) => void pasted.push(text),
  } as unknown as Tmux;
  const queueFile = join(dir, 'queue.json');
  if (queued.length) writeFileSync(queueFile, JSON.stringify({ sessions: { abc: queued }, sent: {} }));
  const machine = new LocalMachine({ tmux, store, claudeSettingsPath: '/dev/null', claudeProjectsRoot: root, queueFile });
  // How each message stands in the journal, as the page shows it.
  const states = () => machine.journal.messages('abc').map((m) => [m.text, m.state]);
  return { machine, pasted, states };
}

const settled = () => new Promise((r) => setTimeout(r, 20));

describe('LocalMachine', () => {
  describe('when the server starts while Claude works', () => {
    it('knows it is working from the transcript, and puts what waited from before into Claude\'s own queue', async () => {
      const { machine, pasted, states } = setup([prompt(ago(5000)), toolUse(ago(3000))], [{ id: 'q1', text: 'later', at: 1 }]);
      await machine.listSessions();
      await vi.waitFor(() => expect(machine.getStatus('abc')).toBe('working'));
      await machine.listSessions();
      await vi.waitFor(() => expect(pasted).toEqual(['later']));
      expect(states()).toEqual([['later', 'enqueued']]);
    });

    it('says it is working on the first listing, never idle before the status is read', async () => {
      const { machine } = setup([prompt(ago(5000)), toolUse(ago(3000))]);
      const [s] = await machine.listSessions();
      expect(s.status).toBe('working');
    });

    // Sent before anything has read the status, it goes the way the status read then says: into the queue
    // of a Claude at work, not to a prompt taken as idle.
    it('reads the status before a message sent first goes', async () => {
      const { machine, pasted, states } = setup([prompt(ago(5000)), toolUse(ago(3000))]);
      expect(await machine.sendMessage('abc', 'hi')).toBeNull();
      expect(pasted).toEqual(['hi']);
      expect(states()).toEqual([['hi', 'enqueued']]);
    });

    it('takes Claude at its prompt as idle when the transcript says the turn is over', async () => {
      const { machine } = setup([prompt(ago(60_000)), stopped(ago(50_000))]);
      await machine.listSessions();
      await vi.waitFor(() => expect(machine.getStatus('abc')).toBe('idle'));
    });

    it('takes it as idle, as before, with no transcript to read', async () => {
      const { machine } = setup(null);
      await machine.listSessions();
      await vi.waitFor(() => expect(machine.getStatus('abc')).toBe('idle'));
    });
  });

  describe('when a session is left working with no hook to say the turn is over', () => {
    it.each([
      ['stopped with Esc in the terminal', interrupted],
      ['ended with no word from the hooks', stopped],
    ])('makes it idle once the transcript has said so a while: %s', async (_, end) => {
      const { machine } = setup([prompt(ago(60_000)), end(ago(30_000))]);
      // The Mac saw the turn start before it ended.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() - 45_000);
      machine.setStatus('abc', 'working');
      vi.useRealTimers();
      await machine.listSessions();
      await vi.waitFor(() => expect(machine.getStatus('abc')).toBe('idle'));
    });

    it('keeps it working while the turn has only just ended, for the hook that is on its way', async () => {
      const { machine } = setup([prompt(ago(60_000)), stopped(ago(1000))]);
      machine.setStatus('abc', 'working');
      await machine.listSessions();
      await settled();
      expect(machine.getStatus('abc')).toBe('working');
    });

    it('keeps it working while the turn goes on', async () => {
      const { machine } = setup([prompt(ago(60_000)), toolUse(ago(30_000))]);
      machine.setStatus('abc', 'working');
      await machine.listSessions();
      await settled();
      expect(machine.getStatus('abc')).toBe('working');
    });
  });
});
