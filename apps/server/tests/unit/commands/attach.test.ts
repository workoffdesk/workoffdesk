import { describe, expect, it } from 'vitest';
import { attachChoices } from '../../../src/commands/attach.js';
import type { PastSession, SessionMeta } from '../../../src/system/store.js';

// `workoffdesk attach` with no id: the sessions to pick from, the running ones and then the ended ones whose
// conversation can be gone on with.
const meta = (more: Partial<SessionMeta> = {}): SessionMeta => ({ title: 'project', kind: 'claude', cwd: '/tmp/project', createdAt: 1, ...more });
const past = (lastActivity: number, more: Partial<SessionMeta> = {}): PastSession => ({ ...meta({ claudeSessionId: 'c-' + lastActivity, ...more }), lastActivity });

describe('attachChoices', () => {
  it('lists the running sessions first, as tmux has them, then the ended ones, the latest first', () => {
    const choices = attachChoices(['live0002', 'live0001'], {
      sessions: { live0001: meta(), live0002: meta() },
      past: { past0001: past(100), past0002: past(300), past0003: past(200) },
    });
    expect(choices.map((c) => [c.id, c.ended])).toEqual([
      ['live0002', false],
      ['live0001', false],
      ['past0002', true],
      ['past0003', true],
      ['past0001', true],
    ]);
  });

  it('lists an ended Codex session, which goes on with its thread', () => {
    const choices = attachChoices([], { sessions: {}, past: { past0001: past(1, { kind: 'codex', claudeSessionId: undefined, codexThreadId: 't-1' }) } });
    expect(choices.map((c) => c.id)).toEqual(['past0001']);
  });

  it('leaves out an ended session with no conversation to go on with', () => {
    expect(attachChoices([], { sessions: {}, past: { past0001: past(1, { claudeSessionId: undefined }) } })).toEqual([]);
  });

  it('lists a session once when it runs again and is still kept as ended', () => {
    const choices = attachChoices(['same0001'], { sessions: { same0001: meta() }, past: { same0001: past(1) } });
    expect(choices.map((c) => [c.id, c.ended])).toEqual([['same0001', false]]);
  });

  it('lists a running session tmux has that the state does not know, with nothing to say of it', () => {
    expect(attachChoices(['live0001'], { sessions: {}, past: {} })).toEqual([{ id: 'live0001', meta: undefined, ended: false }]);
  });
});
