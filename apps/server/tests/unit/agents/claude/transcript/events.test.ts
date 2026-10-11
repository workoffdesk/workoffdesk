import { describe, expect, it } from 'vitest';
import { envelopeOf, eventOf } from '../../../../../src/agents/claude/transcript/events.js';

// Each record shape below is as Claude Code writes it, taken from real transcripts.
const at = '2026-10-11T09:00:00.000Z';
const user = (content: unknown, more: object = {}) => ({ type: 'user', timestamp: at, message: { role: 'user', content }, ...more });
const text = (t: string) => [{ type: 'text', text: t }];
const assistant = (content: unknown, more: object = {}) => ({ type: 'assistant', timestamp: at, message: { role: 'assistant', content }, ...more });
const system = (subtype: string, more: object = {}) => ({ type: 'system', subtype, timestamp: at, ...more });
const queued = (attachment: object) => ({ type: 'attachment', timestamp: at, attachment: { type: 'queued_command', ...attachment } });

describe('eventOf', () => {
  it.each<[string, unknown, object]>([
    ['a prompt typed', user('do it'), { k: 'claude:prompt', text: 'do it', words: 'do it', at }],
    ['a prompt sent by the person', user('do it', { origin: { kind: 'human' } }), { k: 'claude:prompt', text: 'do it' }],
    ['a prompt with a picture', user([{ type: 'image' }, ...text('look')]), { k: 'claude:prompt', text: '[image] look', words: 'look' }],
    ['a prompt pasted', user('<pasted_content id="p1">\nhello\n</pasted_content id="p1">'), { k: 'claude:prompt', text: 'hello', words: 'hello' }],
    ['a note Claude Code adds', user('<local-command-caveat>Caveat</local-command-caveat>', { isMeta: true }), { k: 'claude:noted' }],
    ['a note of the person\'s origin', user('skill body', { isMeta: true, origin: { kind: 'human' } }), { k: 'claude:noted' }],
    ['a note of another origin', user('go on', { isMeta: true, origin: { kind: 'auto-continuation' } }), { k: 'claude:noted' }],
    ['the summary a compaction goes on from', user('This session is being continued…', { isCompactSummary: true, isVisibleInTranscriptOnly: true }), { k: 'claude:compacted' }],
    ['answers to calls', user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }], { toolUseResult: { x: 1 } }), { k: 'claude:results', results: [{ id: 't1', text: 'ok', error: false, image: false }], detail: { x: 1 } }],
    ['Esc', user(text('[Request interrupted by user]')), { k: 'claude:interrupted' }],
    ['Esc during a call', user(text('[Request interrupted by user for tool use]')), { k: 'claude:interrupted' }],
    ['a command typed', user('<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args>now</command-args>'), { k: 'claude:command', name: '/review', args: 'now', local: false }],
    ['what a command printed', user('<local-command-stdout>Set model to Opus</local-command-stdout>'), { k: 'claude:commandOutput', text: 'Set model to Opus', local: false }],
    ['a command run on its own', system('local_command', { content: '<command-name>/model</command-name>\n<command-args>opus</command-args>' }), { k: 'claude:command', name: '/model', args: 'opus', local: true }],
    ['what such a command printed', system('local_command', { content: '<local-command-stdout>Set model</local-command-stdout>' }), { k: 'claude:commandOutput', text: 'Set model', local: true }],
    ['a shell command at the prompt', user('<bash-input>pwd</bash-input>'), { k: 'claude:shell', command: 'pwd' }],
    ['what it printed', user('<bash-stdout>/x</bash-stdout><bash-stderr>warn</bash-stderr>'), { k: 'claude:shellOutput', text: '/x\nwarn' }],
    ['a teammate\'s message', user('hi', { isMeta: true, origin: { kind: 'peer', name: 'qa', body: 'all green' } }), { k: 'claude:peer', from: 'qa', body: 'all green' }],
    [
      'teammates\' messages in their envelope',
      user('Another Claude session sent a message:\n<teammate-message teammate_id="qa">all green</teammate-message>'),
      { k: 'claude:teammates', messages: [{ from: 'qa', body: 'all green' }] },
    ],
    ['how a background command ended', user('<task-notification>…</task-notification>', { origin: { kind: 'task-notification' } }), { k: 'claude:taskNotification', text: '<task-notification>…</task-notification>' }],
    ['a prompt from somewhere else', user('wake up', { origin: { kind: 'schedule' } }), { k: 'claude:fromOther', text: 'wake up' }],
    ['a reply', assistant([{ type: 'thinking' }, ...text('done'), { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]), {
      k: 'claude:reply',
      blocks: [{ type: 'text', text: 'done' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }],
    }],
    ['a reply the API failed to give', assistant(text('API Error: 529'), { isApiErrorMessage: true }), { k: 'claude:apiError', limit: false, text: 'API Error: 529' }],
    ['a usage limit', assistant(text('limit'), { isApiErrorMessage: true, error: 'rate_limit' }), { k: 'claude:apiError', limit: true }],
    ['the turn over', system('stop_hook_summary'), { k: 'claude:turnOver', at }],
    ['a compaction asked for', system('compact_boundary', { compactMetadata: { trigger: 'manual' } }), { k: 'claude:compactBoundary', manual: true }],
    ['a compaction on its own', system('compact_boundary', { compactMetadata: { trigger: 'auto' } }), { k: 'claude:compactBoundary', manual: false }],
    ['a message put in Claude\'s queue', { type: 'queue-operation', operation: 'enqueue', content: 'more' }, { k: 'claude:queue', op: 'enqueue', text: 'more' }],
    ['one taken from it', { type: 'queue-operation', operation: 'dequeue' }, { k: 'claude:queue', op: 'dequeue' }],
    ['a message taken mid-turn', queued({ prompt: 'and this', commandMode: 'prompt', origin: { kind: 'human' } }), { k: 'claude:midTurnPrompt', text: 'and this' }],
    ['a background command ended mid-turn', queued({ prompt: '<task-notification>…</task-notification>', commandMode: 'task-notification' }), { k: 'claude:midTurnTaskEnd' }],
    ['a note taken mid-turn', queued({ prompt: 'x', isMeta: true }), { k: 'claude:other' }],
    ['a name given', { type: 'custom-title', customTitle: 'Mine' }, { k: 'claude:title', by: 'person', text: 'Mine' }],
    ['a name Claude made up', { type: 'ai-title', aiTitle: 'Its' }, { k: 'claude:title', by: 'claude', text: 'Its' }],
    ['the last prompt Claude Code noted', { type: 'last-prompt', lastPrompt: 'that' }, { k: 'claude:lastPrompt', text: 'that' }],
    ['a subagent\'s', user('x', { isSidechain: true }), { k: 'claude:sidechain' }],
    ['a user record with no message', { type: 'user' }, { k: 'claude:other' }],
    ['an attachment of another kind', { type: 'attachment', attachment: { type: 'total_tokens_reminder' } }, { k: 'claude:other' }],
    ['a system record of another kind', system('turn_duration'), { k: 'claude:other' }],
    ['a kind not known', { type: 'mode' }, { k: 'claude:other' }],
    ['not an object', 'oops', { k: 'claude:other' }],
    ['null', null, { k: 'claude:other' }],
  ])('%s', (_, record, event) => {
    expect(eventOf(record)).toMatchObject(event);
  });
});

describe('envelopeOf', () => {
  it('reads the folder and who ran it', () => {
    expect(envelopeOf({ type: 'user', cwd: '/w', entrypoint: 'sdk-cli' })).toEqual({ cwd: '/w', automated: true });
    expect(envelopeOf({ type: 'user', cwd: '', entrypoint: 'cli' })).toEqual({ cwd: null, automated: false });
    expect(envelopeOf(null)).toEqual({ cwd: null, automated: false });
  });
});
