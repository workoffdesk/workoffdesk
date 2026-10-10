import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHookHandler } from '../../../../../src/agents/claude/hooks/tracker.js';
import { LocalMachine } from '../../../../../src/sessions/machine.js';
import { Store } from '../../../../../src/system/store.js';
import type { Tmux } from '../../../../../src/system/tmux.js';

const fixture = (name: string) => readFileSync(new URL(`../../../../fixtures/screens/${name}.txt`, import.meta.url), 'utf8');
const COMPACTING = fixture('compacting');
const AT_PROMPT = fixture('idle-after-answer');

function setup() {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'ts-compact-')), 'state.json'));
  store.update((s) => {
    s.sessions.abc = { title: 'proj', kind: 'claude', cwd: '/x', claudeSessionId: 'u', createdAt: 1 };
  });
  let shown = AT_PROMPT;
  // Only the plain screen is read here; what else a read of it asks for fails, as it may, and is done without.
  const unread = async () => {
    throw new Error('not read in these tests');
  };
  const tmux = { screenAndAbove: async () => ({ screen: shown, above: '' }), screenStyled: unread, screenJoined: unread, windowSize: unread } as unknown as Tmux;
  const machine = new LocalMachine({ tmux, store, claudeSettingsPath: '/dev/null' });
  const pushes: string[] = [];
  const handle = createHookHandler(machine, { notify: async (_id, _t, event) => void pushes.push(event) });
  const show = async (screen: string) => {
    shown = screen;
    await machine.onScreen('abc');
  };
  return { machine, handle, pushes, show };
}

describe('createHookHandler', () => {
  describe('when the hooks report a compaction', () => {
    it('makes it a status of its own, and one made mid-answer goes back to the answer', () => {
      const { machine, handle, pushes } = setup();
      handle('abc', { hook_event_name: 'UserPromptSubmit' });
      handle('abc', { hook_event_name: 'PreCompact', trigger: 'auto' });
      expect(machine.getStatus('abc')).toBe('compacting');
      handle('abc', { hook_event_name: 'PostCompact', trigger: 'auto' });
      expect(machine.getStatus('abc')).toBe('working');
      handle('abc', { hook_event_name: 'Stop' });
      expect(pushes).toEqual(['idle']);
    });

    it('ends one asked for with /compact at the prompt', () => {
      const { machine, handle, pushes } = setup();
      handle('abc', { hook_event_name: 'UserPromptSubmit' });
      handle('abc', { hook_event_name: 'PreCompact', trigger: 'manual' });
      handle('abc', { hook_event_name: 'PostCompact', trigger: 'manual' });
      expect(machine.getStatus('abc')).toBe('idle');
      expect(pushes).toEqual([]);
    });

    it('ends it with whatever Claude does next, and a late PostCompact does not take it back', () => {
      const { machine, handle } = setup();
      handle('abc', { hook_event_name: 'UserPromptSubmit' });
      handle('abc', { hook_event_name: 'PreCompact', trigger: 'auto' });
      handle('abc', { hook_event_name: 'Stop' });
      expect(machine.getStatus('abc')).toBe('idle');
      handle('abc', { hook_event_name: 'PostCompact', trigger: 'auto' });
      expect(machine.getStatus('abc')).toBe('idle');
    });

    it('changes nothing on a PostCompact without a PreCompact', () => {
      const { machine, handle } = setup();
      handle('abc', { hook_event_name: 'UserPromptSubmit' });
      handle('abc', { hook_event_name: 'PostCompact', trigger: 'manual' });
      expect(machine.getStatus('abc')).toBe('working');
    });
  });

  // A session started before workoffdesk asked for the compaction hooks never reports them; its screen does.
  describe('when the screen shows a compaction', () => {
    it('starts and ends it with the spinner', async () => {
      const { machine, handle, show } = setup();
      handle('abc', { hook_event_name: 'UserPromptSubmit' });
      await show(COMPACTING);
      expect(machine.getStatus('abc')).toBe('compacting');
      await show(AT_PROMPT);
      expect(machine.getStatus('abc')).toBe('working');
    });

    it('does not end one the hooks began from a screen that never showed the spinner', async () => {
      const { machine, handle, show } = setup();
      handle('abc', { hook_event_name: 'PreCompact', trigger: 'auto' });
      await show(AT_PROMPT);
      expect(machine.getStatus('abc')).toBe('compacting');
    });

    // Esc cancels a compaction, and no PostCompact follows.
    it('ends one the hooks began once the spinner it showed is gone', async () => {
      const { machine, handle, show } = setup();
      handle('abc', { hook_event_name: 'Stop' });
      handle('abc', { hook_event_name: 'PreCompact', trigger: 'manual' });
      await show(COMPACTING);
      await show(AT_PROMPT);
      expect(machine.getStatus('abc')).toBe('idle');
    });

    it('needs the next compaction to show its spinner again before the screen may end it', async () => {
      const { machine, handle, show } = setup();
      handle('abc', { hook_event_name: 'PreCompact', trigger: 'auto' });
      await show(COMPACTING);
      handle('abc', { hook_event_name: 'PostCompact', trigger: 'auto' });
      handle('abc', { hook_event_name: 'PreCompact', trigger: 'auto' });
      await show(AT_PROMPT);
      expect(machine.getStatus('abc')).toBe('compacting');
    });
  });
});
