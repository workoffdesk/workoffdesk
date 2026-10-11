import { describe, expect, it } from 'vitest';
import { itemEventOf, rolloutEventOf, turnEventOf } from '../../../../src/agents/codex/events.js';

// Codex writes a conversation down three ways: its app server's items and turns, and the rollout file.
const AT = '2026-10-11T09:00:00.000Z';

describe('itemEventOf', () => {
  it.each<[string, unknown, object]>([
    [
      'what the person typed',
      { id: 'u1', type: 'userMessage', clientId: 'q1', content: [{ type: 'text', text: 'do' }, { type: 'image' }, { type: 'text', text: '' }, { type: 'text', text: 'it' }] },
      { k: 'codex:userMessage', id: 'u1', text: 'do\nit', clientId: 'q1', at: AT },
    ],
    ['what Codex said', { id: 'a1', type: 'agentMessage', text: 'done' }, { k: 'codex:agentMessage', id: 'a1', text: 'done' }],
    ['its plan', { id: 'p1', type: 'plan', text: '1. this' }, { k: 'codex:plan', id: 'p1', text: '1. this' }],
    [
      'a command, as Codex parsed it',
      { id: 'c1', type: 'commandExecution', commandActions: [{ command: 'npm test' }], command: "/bin/zsh -lc 'npm test'", aggregatedOutput: 'ok', status: 'completed', exitCode: 0 },
      { k: 'codex:commandExecution', id: 'c1', command: 'npm test', output: 'ok', status: 'completed', exitCode: 0 },
    ],
    ['a command Codex did not parse', { id: 'c1', type: 'commandExecution', command: 'ls', status: 'failed' }, { k: 'codex:commandExecution', command: 'ls', output: '', status: 'failed' }],
    [
      'files changed, each where it was, one with no path too',
      { id: 'f1', type: 'fileChange', status: 'completed', changes: [{ path: '/a', kind: { type: 'add' }, diff: '+a' }, { kind: { type: 'update' } }, { path: '/b', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-x\n+y' }] },
      {
        k: 'codex:fileChange',
        id: 'f1',
        status: 'completed',
        changes: [
          { path: '/a', kind: 'add', diff: '+a' },
          { path: '', kind: 'update', diff: '' },
          { path: '/b', kind: 'update', diff: '@@ -1 +1 @@\n-x\n+y' },
        ],
      },
    ],
    [
      "another program's tool",
      { id: 't1', type: 'mcpToolCall', server: 'gh', tool: 'pr', arguments: { n: '7' }, result: { content: [{ text: 'merged' }] }, status: 'completed' },
      { k: 'codex:toolCall', id: 't1', name: 'gh.pr', args: { n: '7' }, text: 'merged', failed: false },
    ],
    [
      'a dynamic tool that failed',
      { id: 't1', type: 'dynamicToolCall', namespace: 'web', tool: 'get', contentItems: [{ text: 'partial' }], error: { message: 'timeout' } },
      { k: 'codex:toolCall', name: 'web.get', args: {}, text: 'timeout', failed: true },
    ],
    ['a tool that said it did not succeed', { id: 't1', type: 'mcpToolCall', tool: 'x', success: false }, { k: 'codex:toolCall', name: 'x', failed: true }],
    ['a web search', { id: 'w1', type: 'webSearch', query: 'q' }, { k: 'codex:webSearch', id: 'w1', query: 'q' }],
    ['a picture looked at', { id: 'i1', type: 'imageView', path: '/s.png' }, { k: 'codex:imageView', id: 'i1', path: '/s.png' }],
    ['the conversation compacted', { id: 'x1', type: 'contextCompaction' }, { k: 'codex:compaction', id: 'x1' }],
    ['its reasoning', { id: 'r1', type: 'reasoning' }, { k: 'codex:other' }],
    ['a kind not known', { id: 'n1', type: 'somethingNew' }, { k: 'codex:other' }],
    ['an item with no id', { type: 'agentMessage', text: 'x' }, { k: 'codex:other' }],
    ['not an item', [], { k: 'codex:other' }],
    ['null', null, { k: 'codex:other' }],
  ])('%s', (_, item, event) => {
    expect(itemEventOf(item, AT)).toMatchObject(event);
  });

  it('has no exit code when Codex gave none', () => {
    expect(itemEventOf({ id: 'c1', type: 'commandExecution', command: 'ls', exitCode: 'x' })).not.toHaveProperty('exitCode');
  });

  it('has no time when none is given', () => {
    expect(itemEventOf({ id: 'a1', type: 'agentMessage', text: 'x' })).not.toHaveProperty('at');
  });
});

describe('turnEventOf', () => {
  it.each<[string, unknown, object]>([
    ['completed', { id: 't1', status: 'completed' }, { k: 'codex:turnEnded', id: 't1', how: 'completed', error: '' }],
    ['interrupted', { id: 't1', status: 'interrupted' }, { k: 'codex:turnEnded', how: 'interrupted' }],
    ['failed, with why', { id: 't1', status: 'failed', error: { message: 'overloaded' } }, { k: 'codex:turnEnded', how: 'failed', error: 'overloaded' }],
    ['still going', { id: 't1', status: 'inProgress' }, { k: 'codex:other' }],
    ['a status named like what every object has', { id: 't1', status: 'toString' }, { k: 'codex:other' }],
    ['a status named like an object\'s maker', { id: 't1', status: 'constructor' }, { k: 'codex:other' }],
    ['a turn with no id', { status: 'failed' }, { k: 'codex:other' }],
    ['not a turn', null, { k: 'codex:other' }],
  ])('%s', (_, turn, event) => {
    expect(turnEventOf(turn)).toMatchObject(event);
  });
});

describe('rolloutEventOf', () => {
  const msg = (payload: object) => ({ timestamp: AT, type: 'event_msg', payload });
  it.each<[string, unknown, object]>([
    ['a turn started', msg({ type: 'task_started' }), { k: 'codex:rolloutTurnStarted', at: AT }],
    ['a turn done', msg({ type: 'task_complete' }), { k: 'codex:rolloutTurnEnded', how: 'completed' }],
    ['a turn stopped', msg({ type: 'turn_aborted' }), { k: 'codex:rolloutTurnEnded', how: 'aborted' }],
    [
      'what the person typed',
      msg({ type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }),
      { k: 'codex:rolloutPrompt', text: 'a\nb' },
    ],
    ['what the person typed, as an older Codex wrote it', msg({ type: 'user_message', message: 'hi there' }), { k: 'codex:rolloutPrompt', text: 'hi there' }],
    ['another item done', msg({ type: 'item_completed', item: { type: 'AgentMessage' } }), { k: 'codex:other' }],
    ['another event', msg({ type: 'token_count' }), { k: 'codex:other' }],
    ['a line that is no event', { type: 'response_item', payload: { type: 'task_started' } }, { k: 'codex:other' }],
    ['not a line', 'x', { k: 'codex:other' }],
  ])('%s', (_, line, event) => {
    expect(rolloutEventOf(line)).toMatchObject(event);
  });
});
