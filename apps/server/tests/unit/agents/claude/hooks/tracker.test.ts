import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHookHandler } from '../../../../../src/agents/claude/hooks/tracker.js';
import { LocalMachine } from '../../../../../src/sessions/machine.js';
import { Store } from '../../../../../src/system/store.js';
import { Tmux } from '../../../../../src/system/tmux.js';

function setup() {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'ts-track-')), 'state.json'));
  store.update((s) => {
    s.sessions.abc = { title: 'proj', kind: 'claude', cwd: '/x', claudeSessionId: 'u', createdAt: 1 };
  });
  const machine = new LocalMachine({ tmux: new Tmux({ socket: 'unused', conf: '/dev/null' }), store, claudeSettingsPath: '/dev/null' });
  const pushes: [string, string, string][] = [];
  const handle = createHookHandler(machine, { notify: async (id, t, b) => void pushes.push([id, t, b]) });
  return { machine, pushes, handle };
}

describe('createHookHandler', () => {
  it('moves the session through statuses and pushes when Claude needs the user', () => {
    const { machine, pushes, handle } = setup();
    handle('abc', { hook_event_name: 'UserPromptSubmit' });
    expect(machine.getStatus('abc')).toBe('working');
    expect(pushes).toEqual([]);
    handle('abc', { hook_event_name: 'Notification' });
    expect(machine.getStatus('abc')).toBe('waiting');
    handle('abc', { hook_event_name: 'PostToolUse' });
    handle('abc', { hook_event_name: 'Stop' });
    expect(machine.getStatus('abc')).toBe('idle');
    expect(pushes).toEqual([
      ['abc', 'proj', 'waiting'],
      ['abc', 'proj', 'idle'],
    ]);
  });

  it('does not take Claude idling at its prompt for a wait on the user', () => {
    const { machine, pushes, handle } = setup();
    handle('abc', { hook_event_name: 'UserPromptSubmit' });
    handle('abc', { hook_event_name: 'Stop' });
    handle('abc', { hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
    expect(machine.getStatus('abc')).toBe('idle');
    handle('abc', { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' });
    expect(machine.getStatus('abc')).toBe('waiting');
    expect(pushes).toEqual([
      ['abc', 'proj', 'idle'],
      ['abc', 'proj', 'waiting'],
    ]);
  });

  it('ignores events for sessions workoffdesk does not know', () => {
    const { machine, pushes, handle } = setup();
    handle('zzz', { hook_event_name: 'Notification' });
    expect(machine.getStatus('zzz')).toBeNull();
    expect(pushes).toEqual([]);
  });

  it('ignores payloads without an event name', () => {
    const { machine, handle } = setup();
    handle('abc', { hook_event_name: 'UserPromptSubmit' });
    handle('abc', {});
    expect(machine.getStatus('abc')).toBe('working');
  });

  // A /clear, a resume or a compaction can move Claude to a new transcript; the hooks say which.
  it('follows the Claude session the hooks report, without changing the status', () => {
    const { machine, handle } = setup();
    const next = '9d5e2f10-2222-4333-8444-955556666777';
    handle('abc', { hook_event_name: 'SessionStart', session_id: next });
    expect(machine.sessionMeta('abc')?.claudeSessionId).toBe(next);
    expect(machine.getStatus('abc')).toBeNull();
    handle('abc', { hook_event_name: 'Stop', session_id: 'not-a-session-id' });
    expect(machine.sessionMeta('abc')?.claudeSessionId).toBe(next);
  });

  // What Claude Code writes of its own queue: a message typed while it works waits there (enqueue) until it
  // takes it into the turn under way (remove) or starts a turn with it (dequeue).
  describe('when a turn ends while Claude still holds a message of its own queue', () => {
    afterEach(() => vi.useRealTimers());
    const op = (operation: string, content?: string) =>
      JSON.stringify({ type: 'queue-operation', operation, timestamp: '2026-10-05T12:00:00.000Z', ...(content ? { content } : {}) }) + '\n';
    // Written by Claude once the Stop hooks are done, before it takes the next message of its queue.
    const stopped = JSON.stringify({ type: 'system', subtype: 'stop_hook_summary', timestamp: '2026-10-05T12:00:00.000Z' }) + '\n';
    const transcript = (...lines: string[]) => {
      const path = join(mkdtempSync(join(tmpdir(), 'ts-track-')), 't.jsonl');
      writeFileSync(path, JSON.stringify({ type: 'user', message: { role: 'user', content: 'go' } }) + '\n' + lines.join(''));
      return path;
    };

    it('keeps the turn going: Claude goes on with that message, and nothing says it is done', () => {
      vi.useFakeTimers();
      const { machine, pushes, handle } = setup();
      const path = transcript(op('enqueue', 'now please'));
      handle('abc', { hook_event_name: 'UserPromptSubmit', transcript_path: path });
      handle('abc', { hook_event_name: 'Stop', transcript_path: path });
      expect(machine.getStatus('abc')).toBe('working');
      appendFileSync(path, stopped + op('dequeue'));
      handle('abc', { hook_event_name: 'UserPromptSubmit', transcript_path: path });
      vi.advanceTimersByTime(60_000);
      expect(machine.getStatus('abc')).toBe('working');
      expect(pushes).toEqual([]);
      handle('abc', { hook_event_name: 'Stop', transcript_path: path });
      expect(machine.getStatus('abc')).toBe('idle');
      expect(pushes).toEqual([['abc', 'proj', 'idle']]);
    });

    it.each([
      ['taken into the turn', [op('enqueue', 'a'), op('remove', 'a')]],
      ['started a turn', [op('enqueue', 'a'), op('dequeue')]],
      ['two typed, both taken', [op('enqueue', 'a'), op('enqueue', 'b'), op('remove', 'b'), op('dequeue')]],
      ['nothing typed', []],
    ])('ends the turn once Claude holds nothing: %s', (_, lines) => {
      const { machine, handle } = setup();
      const path = transcript(...lines);
      handle('abc', { hook_event_name: 'UserPromptSubmit', transcript_path: path });
      handle('abc', { hook_event_name: 'Stop', transcript_path: path });
      expect(machine.getStatus('abc')).toBe('idle');
    });

    it('keeps the turn going when it fails too: Claude goes on with that message all the same', () => {
      vi.useFakeTimers();
      const { machine, pushes, handle } = setup();
      const path = transcript(op('enqueue', 'now please'));
      handle('abc', { hook_event_name: 'UserPromptSubmit', transcript_path: path });
      handle('abc', { hook_event_name: 'StopFailure', transcript_path: path });
      expect(machine.getStatus('abc')).toBe('working');
      appendFileSync(path, op('dequeue') + JSON.stringify({ type: 'user', message: { role: 'user', content: 'now please' } }) + '\n');
      vi.advanceTimersByTime(60_000);
      expect(machine.getStatus('abc')).toBe('working');
      expect(pushes).toEqual([]);
    });

    it('keeps the turn going when Claude starts the next turn without a hook to say so', () => {
      vi.useFakeTimers();
      const { machine, pushes, handle } = setup();
      const path = transcript(op('enqueue', 'now please'));
      handle('abc', { hook_event_name: 'UserPromptSubmit', transcript_path: path });
      handle('abc', { hook_event_name: 'Stop', transcript_path: path });
      appendFileSync(path, stopped + op('dequeue') + JSON.stringify({ type: 'user', message: { role: 'user', content: 'now please' } }) + '\n');
      vi.advanceTimersByTime(60_000);
      expect(machine.getStatus('abc')).toBe('working');
      expect(pushes).toEqual([]);
    });

    it('ends the turn after all when Claude does not start the next turn soon', () => {
      vi.useFakeTimers();
      const { machine, pushes, handle } = setup();
      const path = transcript(op('enqueue', 'a'));
      handle('abc', { hook_event_name: 'UserPromptSubmit', transcript_path: path });
      handle('abc', { hook_event_name: 'Stop', transcript_path: path });
      appendFileSync(path, stopped);
      expect(machine.getStatus('abc')).toBe('working');
      vi.advanceTimersByTime(10_000);
      expect(machine.getStatus('abc')).toBe('idle');
      expect(pushes).toEqual([['abc', 'proj', 'idle']]);
    });

    it('ends the turn as before when the transcript cannot be read', () => {
      const { machine, handle } = setup();
      handle('abc', { hook_event_name: 'UserPromptSubmit' });
      handle('abc', { hook_event_name: 'Stop', transcript_path: '/no/such/transcript.jsonl' });
      expect(machine.getStatus('abc')).toBe('idle');
    });
  });
});
