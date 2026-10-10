import { describe, expect, it } from 'vitest';
import { HOOK_EVENTS, nextStatus, notificationFor } from '../../../../../src/agents/claude/hooks/status.js';

describe('nextStatus', () => {
  it.each([
    [null, 'UserPromptSubmit', 'working'],
    ['idle', 'UserPromptSubmit', 'working'],
    ['waiting', 'PostToolUse', 'working'],
    ['working', 'Notification', 'waiting'],
    ['working', 'Stop', 'idle'],
    ['waiting', 'Stop', 'idle'],
    // A turn ended by an API error, a rate limit or an overload (seen from v2.1.289).
    ['working', 'StopFailure', 'idle'],
    ['idle', 'PostToolUse', 'working'],
    // Sent on /clear too, while Claude goes on: whether it ended is read off its process (machine.ts).
    ['working', 'SessionEnd', 'working'],
    ['idle', 'SessionEnd', 'idle'],
    ['ended', 'UserPromptSubmit', 'working'],
    ['working', 'SomethingNew', 'working'],
    [null, 'SomethingNew', null],
    ['working', 'SessionStart', 'working'],
  ] as const)('%s + %s -> %s', (prev, event, next) => {
    expect(nextStatus(prev, event)).toBe(next);
  });

  // Claude Code says what a notification is about (seen from v2.1.288). Asking is a permission prompt, a
  // question (AskUserQuestion) included; the rest are not a wait on the user.
  describe('on a notification', () => {
    it.each([
      ['permission_prompt', 'waiting'],
      ['elicitation_dialog', 'waiting'],
      [undefined, 'waiting'],
      ['idle_prompt', 'idle'],
      ['auth_success', 'idle'],
      ['something_new', 'idle'],
    ] as const)('%s -> %s', (type, next) => {
      expect(nextStatus('idle', 'Notification', type)).toBe(next);
    });
  });
});

describe('HOOK_EVENTS', () => {
  it('includes SessionStart, to follow the transcript when Claude starts or switches sessions', () => {
    expect(HOOK_EVENTS).toContain('SessionStart');
  });

  it('includes every way a turn ends', () => {
    expect(HOOK_EVENTS).toEqual(expect.arrayContaining(['Stop', 'StopFailure']));
  });

  it('includes the compaction events', () => {
    expect(HOOK_EVENTS).toEqual(expect.arrayContaining(['PreCompact', 'PostCompact']));
  });
});

describe('notificationFor', () => {
  it('notifies when work stops for input or completion only', () => {
    expect(notificationFor('working', 'waiting', 'proj')).toEqual({ title: 'proj', event: 'waiting' });
    expect(notificationFor('working', 'idle', 'proj')).toEqual({ title: 'proj', event: 'idle' });
    expect(notificationFor('idle', 'waiting', 'proj')).toEqual({ title: 'proj', event: 'waiting' });
    expect(notificationFor('idle', 'working', 'proj')).toBeNull();
    expect(notificationFor('waiting', 'idle', 'proj')).toBeNull();
    expect(notificationFor('working', 'ended', 'proj')).toBeNull();
  });
});
