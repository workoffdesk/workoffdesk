import { describe, expect, it } from 'vitest';
import { heldByClaude, lastTurn } from '../../../../../src/agents/claude/transcript/turn.js';

const at = '2026-10-05T12:00:00.000Z';
const line = (o: object) => JSON.stringify({ timestamp: at, ...o });
const prompt = line({ type: 'user', message: { role: 'user', content: 'do it' } });
const toolUse = line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } });
const toolResult = line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
const reply = line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } });
const stopped = line({ type: 'system', subtype: 'stop_hook_summary' });
const interrupted = line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
const apiError = line({ type: 'assistant', isApiErrorMessage: true, message: { role: 'assistant', content: [{ type: 'text', text: 'API Error: 529 Overloaded' }] } });
const meta = line({ type: 'user', isMeta: true, message: { role: 'user', content: 'caveat' } });
const op = (operation: string, content?: string) => line({ type: 'queue-operation', operation, ...(content ? { content } : {}) });
const noise = [line({ type: 'mode' }), line({ type: 'attachment', attachment: { type: 'total_tokens_reminder' } }), line({ type: 'last-prompt' })];

describe('lastTurn', () => {
  it.each([
    ['a prompt just in', [prompt]],
    ['a call under way', [prompt, toolUse]],
    ['a call answered', [prompt, toolUse, toolResult]],
    ['the reply written, the hook not yet run', [prompt, toolUse, toolResult, reply]],
    ['a new turn after the last one ended', [prompt, reply, stopped, prompt]],
    ['a turn started from its own queue', [prompt, reply, stopped, op('dequeue')]],
    ['with entries that say nothing of the turn after it', [prompt, toolUse, ...noise]],
  ])('tells a turn still going: %s', (_, lines) => {
    expect(lastTurn(lines)).toEqual({ over: false });
  });

  it.each([
    ['ended', [prompt, reply, stopped]],
    ['stopped with Esc', [prompt, toolUse, interrupted]],
    ['ended by an API error', [prompt, apiError]],
    ['ended, with entries after it that say nothing of the turn', [prompt, reply, stopped, ...noise, meta]],
  ])('tells a turn that is over: %s', (_, lines) => {
    expect(lastTurn(lines)).toEqual({ over: true, at: Date.parse(at) });
  });

  it('returns null with no turn in the lines, or lines that are not JSON', () => {
    expect(lastTurn([])).toBeNull();
    expect(lastTurn(['{oops', ...noise])).toBeNull();
  });
});

describe('heldByClaude', () => {
  it.each([
    [[op('enqueue', 'a')], 1],
    [[op('enqueue', 'a'), op('remove', 'a')], 0],
    [[op('enqueue', 'a'), op('dequeue')], 0],
    [[op('enqueue', 'a'), op('enqueue', 'b'), op('remove', 'b')], 1],
    [[op('enqueue', 'a'), op('enqueue', 'b'), op('popAll')], 0],
    [[op('dequeue'), op('remove', 'x')], 0],
    [[prompt, reply], 0],
    // What was held before the last turn began was taken by then, however the record of it went.
    [[op('enqueue', 'old'), prompt, reply], 0],
    [[op('enqueue', 'old'), prompt, op('enqueue', 'a'), toolResult, reply, stopped], 1],
    [[prompt, op('enqueue', 'a'), op('remove', 'a'), toolResult, reply, stopped], 0],
  ])('counts what Claude still holds, case %#', (lines, n) => {
    expect(heldByClaude(lines)).toHaveLength(n);
  });
});
