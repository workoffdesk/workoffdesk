import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ClaudeStatus } from '../../../src/agents/types.js';
import { LocalMachine } from '../../../src/sessions/machine.js';
import { Store } from '../../../src/system/store.js';
import type { Tmux } from '../../../src/system/tmux.js';

// How many sessions are working, as the menu bar shows it.
function machineWith(ids: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'wod-working-'));
  const store = new Store(join(dir, 'state.json'));
  store.update((s) => ids.forEach((id, i) => (s.sessions[id] = { title: id, kind: 'claude', cwd: '/x', createdAt: i })));
  const tmux = { listSessions: async () => [] } as unknown as Tmux;
  return new LocalMachine({ tmux, store, claudeSettingsPath: '/dev/null', claudeProjectsRoot: join(dir, 'projects'), queueFile: join(dir, 'queue.json') });
}

describe('LocalMachine.working', () => {
  it('counts none when no session has said how it is', () => {
    expect(machineWith(['a', 'b']).working()).toBe(0);
  });

  it.each<[ClaudeStatus, number]>([
    ['working', 1],
    ['compacting', 1],
    ['waiting', 0],
    ['idle', 0],
    ['starting', 0],
    ['ended', 0],
  ])('counts a session that is %s as %i', (status, n) => {
    const m = machineWith(['a']);
    m.setStatus('a', status);
    expect(m.working()).toBe(n);
  });

  it('counts each working session once', () => {
    const m = machineWith(['a', 'b', 'c']);
    m.setStatus('a', 'working');
    m.setStatus('b', 'compacting');
    m.setStatus('c', 'idle');
    expect(m.working()).toBe(2);
  });

  it('leaves out a status kept for a session the store no longer has', () => {
    const m = machineWith(['a']);
    m.setStatus('gone', 'working');
    expect(m.working()).toBe(0);
  });
});
