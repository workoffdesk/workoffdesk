import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Answer } from '../../../../src/agents/types.js';
import { itemEventOf } from '../../../../src/agents/codex/events.js';
import { askOf, COMMAND_APPROVAL, decisionOf, entriesOf, FILE_APPROVAL, inputOf, isApproval, turnNote, usageOf } from '../../../../src/agents/codex/items.js';

// What Codex's app server says, as the phone's chat, permission cards and usage pill show it.
const AT = '2026-10-08T10:00:00.000Z';
const items = (item: unknown) => entriesOf(item, AT).map((e) => e.item);

describe('entriesOf', () => {
  it.each([null, 'text', [], {}, { type: 'agentMessage', text: 'no id' }])('returns nothing for what is not an item, %j', (item) => {
    expect(entriesOf(item)).toEqual([]);
  });

  it.each(['reasoning', 'somethingNew'])('returns nothing for an item the chat does not show, %s', (type) => {
    expect(entriesOf({ id: 'i1', type, text: 'thinking' })).toEqual([]);
  });

  it("returns what the user typed, its text parts only, with the phone's id for it", () => {
    const content = [
      { type: 'text', text: 'look at this' },
      { type: 'localImage', path: '/tmp/a.png' },
      { type: 'text', text: 'and this' },
    ];
    expect(entriesOf({ id: 'u1', type: 'userMessage', content, clientId: 'c1' }, AT)).toEqual([{ id: 'u1', item: { k: 'user', text: 'look at this\nand this', at: AT }, clientId: 'c1' }]);
    expect(entriesOf({ id: 'u1', type: 'userMessage', content })).toEqual([{ id: 'u1', item: { k: 'user', text: 'look at this\nand this' } }]);
  });

  it.each(['agentMessage', 'plan'])('returns what Codex said, for an %s', (type) => {
    expect(items({ id: 'a1', type, text: 'Done.' })).toEqual([{ k: 'text', text: 'Done.', at: AT }]);
  });

  it.each([
    ['userMessage', { content: [{ type: 'localImage', path: '/tmp/a.png' }] }],
    ['agentMessage', { text: '' }],
    ['plan', {}],
  ])('returns nothing for an empty %s', (type, rest) => {
    expect(entriesOf({ id: 'e1', type, ...rest })).toEqual([]);
  });

  describe('for a command Codex ran', () => {
    const ran = (o: object) => items({ id: 'c1', type: 'commandExecution', command: "/bin/zsh -lc 'ls -la'", ...o });

    it('returns the command as Codex parsed it, and what it printed', () => {
      expect(ran({ commandActions: [{ command: 'ls -la' }], aggregatedOutput: 'total 0', status: 'completed', exitCode: 0 })).toEqual([
        { k: 'tool', id: 'c1', name: 'Bash', summary: 'ls -la', at: AT },
        { k: 'result', id: 'c1', text: 'total 0', error: false },
      ]);
    });

    it('returns the shell line when Codex did not parse it, its first line only, cut at 200', () => {
      expect(ran({ command: `echo ${'x'.repeat(300)}\necho two` })[0]).toMatchObject({ summary: `echo ${'x'.repeat(195)}…` });
    });

    it('carries the whole shell line, to be read once it is opened', () => {
      expect(ran({ command: `echo ${'x'.repeat(300)}\necho two` })[0]).toMatchObject({ input: `echo ${'x'.repeat(300)}\necho two` });
    });

    it('cuts a very long shell line short', () => {
      expect(ran({ command: 'y'.repeat(50_000) })[0]).toMatchObject({ input: `${'y'.repeat(4000)}…` });
    });

    it('carries no more than its summary says, when that is all', () => {
      expect(ran({ commandActions: [{ command: 'ls -la' }] })[0]).not.toHaveProperty('input');
    });

    it('cuts what it printed at 2000 characters', () => {
      expect(ran({ aggregatedOutput: 'y'.repeat(2500) })[1]).toMatchObject({ text: `${'y'.repeat(2000)}…` });
    });

    it.each([
      ['failed', { status: 'failed' }, { error: true }],
      ['ended with an exit code', { status: 'completed', exitCode: 2 }, { error: true }],
      ['succeeded', { status: 'completed', exitCode: 0 }, { error: false }],
      ['was declined', { status: 'declined' }, { error: false, stopped: true }],
    ])('says it %s', (_, o, said) => {
      expect(ran(o)[1]).toMatchObject(said);
    });
  });

  describe('for files Codex changed', () => {
    const DIFF = '@@ -1,3 +1,3 @@\n line one\n-line two\n+line 2\n line three\n@@ -10 +10,2 @@\n ten\n+eleven\n\\ No newline at end of file\n';

    it('returns each file as its own tool, a Write for one made and an Edit for one changed', () => {
      const changes = [
        { path: '/work/new.ts', kind: { type: 'add' }, diff: 'one\ntwo\n' },
        { kind: { type: 'update' }, diff: DIFF },
        { path: '/work/old.ts', kind: { type: 'update' }, diff: DIFF },
      ];
      const got = entriesOf({ id: 'f1', type: 'fileChange', status: 'completed', changes }, AT);
      expect(got.map((e) => [e.id, e.item.k, 'name' in e.item ? e.item.name : null])).toEqual([
        ['f1:0', 'tool', 'Write'],
        ['f1:0#r', 'result', null],
        ['f1:2', 'tool', 'Edit'],
        ['f1:2#r', 'result', null],
      ]);
      expect(got[1].item).toEqual({
        k: 'result',
        id: 'f1:0',
        text: '',
        error: false,
        diff: { file: '/work/new.ts', added: 2, removed: 0, created: true, hunks: [{ oldStart: 0, newStart: 1, lines: ['+one', '+two'] }] },
      });
      expect(got[3].item).toMatchObject({
        diff: {
          file: '/work/old.ts',
          added: 2,
          removed: 1,
          hunks: [
            { oldStart: 1, newStart: 1, lines: [' line one', '-line two', '+line 2', ' line three'] },
            { oldStart: 10, newStart: 10, lines: [' ten', '+eleven'] },
          ],
        },
      });
    });

    it('returns a file removed whole as its lines taken out', () => {
      const [, result] = items({ id: 'f1', type: 'fileChange', changes: [{ path: '/work/gone.ts', kind: { type: 'delete' }, diff: 'a\nb\n' }] });
      expect(result).toMatchObject({ diff: { added: 0, removed: 2, hunks: [{ oldStart: 1, newStart: 0, lines: ['-a', '-b'] }] } });
    });

    it('returns an empty file made as no lines', () => {
      const [, result] = items({ id: 'f1', type: 'fileChange', changes: [{ path: '/work/empty.ts', kind: { type: 'add' }, diff: '' }] });
      expect(result).toMatchObject({ diff: { added: 0, removed: 0, created: true, hunks: [] } });
    });

    it('keeps 300 lines of a long change and says it was cut, counting every line', () => {
      const diff = `@@ -1,0 +1,500 @@\n${Array.from({ length: 500 }, (_, n) => `+${n === 0 ? 'z'.repeat(500) : n}`).join('\n')}\n`;
      const [, result] = items({ id: 'f1', type: 'fileChange', changes: [{ path: '/work/big.ts', kind: { type: 'update' }, diff }] });
      const d = (result as { diff: { added: number; cut: boolean; hunks: { lines: string[] }[] } }).diff;
      expect(d).toMatchObject({ added: 500, cut: true });
      expect(d.hunks[0].lines).toHaveLength(300);
      expect(d.hunks[0].lines[0]).toBe(`+${'z'.repeat(399)}…`);
    });

    it.each([
      ['failed', { error: true }],
      ['declined', { error: false, stopped: true }],
    ])('says a change that %s so', (status, said) => {
      const [, result] = items({ id: 'f1', type: 'fileChange', status, changes: [{ path: '/work/a.ts', kind: { type: 'update' }, diff: DIFF }] });
      expect(result).toMatchObject(said);
    });
  });

  describe("for another program's tool Codex called", () => {
    it("returns the server's tool, by its first argument, with what it gave back", () => {
      const item = { id: 't1', type: 'mcpToolCall', server: 'github', tool: 'search', arguments: { limit: 5, query: 'flaky test\nmore' }, result: { content: [{ text: 'one' }, { type: 'image' }, { text: 'two' }] }, status: 'completed' };
      expect(items(item)).toEqual([
        { k: 'tool', id: 't1', name: 'github.search', summary: 'flaky test', at: AT },
        { k: 'result', id: 't1', text: 'one\ntwo', error: false },
      ]);
    });

    it('returns a dynamic tool by its namespace, with what it gave back', () => {
      expect(items({ id: 't1', type: 'dynamicToolCall', namespace: 'browser', tool: 'open', contentItems: [{ text: 'opened' }], success: true })).toEqual([
        { k: 'tool', id: 't1', name: 'browser.open', summary: '', at: AT },
        { k: 'result', id: 't1', text: 'opened', error: false },
      ]);
    });

    it.each([
      ['its error', { error: { message: 'no such repo' }, result: { content: [{ text: 'ignored' }] } }, 'no such repo'],
      ['a status of failed', { status: 'failed' }, ''],
      ['no success', { success: false }, ''],
    ])('says it failed, by %s', (_, o, text) => {
      expect(items({ id: 't1', type: 'mcpToolCall', server: 's', tool: 't', ...o })[1]).toMatchObject({ text, error: true });
    });

    it('returns a tool by no name when it has none', () => {
      expect(items({ id: 't1', type: 'mcpToolCall' })[0]).toMatchObject({ name: 'tool' });
    });
  });

  it.each([
    ['a web search', { type: 'webSearch', query: 'vitest waitFor' }, { k: 'tool', id: 'w1', name: 'WebSearch', summary: 'vitest waitFor', at: AT }],
    ['a picture looked at', { type: 'imageView', path: '/work/shot.png' }, { k: 'tool', id: 'w1', name: 'Read', summary: '/work/shot.png', at: AT }],
    ['the conversation compacted', { type: 'contextCompaction' }, { k: 'note', event: { e: 'compacted' } }],
  ])('returns %s', (_, o, item) => {
    expect(items({ id: 'w1', ...o })).toEqual([item]);
  });
});

describe('turnNote', () => {
  it.each([
    ['interrupted', { status: 'interrupted' }, { id: 't1#end', item: { k: 'note', event: { e: 'interrupted' } } }],
    ['failed, with why', { status: 'failed', error: { message: 'model overloaded' } }, { id: 't1#end', item: { k: 'note', event: { e: 'failed' }, detail: 'model overloaded' } }],
    ['failed, saying nothing of why', { status: 'failed' }, { id: 't1#end', item: { k: 'note', event: { e: 'failed' } } }],
    ['completed', { status: 'completed' }, null],
    ['in progress', { status: 'inProgress' }, null],
  ])('returns the line, if any, after a turn %s', (_, o, note) => {
    expect(turnNote({ id: 't1', ...o })).toEqual(note);
  });

  it('returns none for what is not a turn', () => {
    expect(turnNote({ status: 'failed' })).toBeNull();
    expect(turnNote(null)).toBeNull();
  });
});

describe('isApproval', () => {
  it.each([COMMAND_APPROVAL, FILE_APPROVAL])('is true for %s', (method) => {
    expect(isApproval(method)).toBe(true);
  });

  it.each(['item/tool/requestUserInput', 'turn/started'])('is false for %s', (method) => {
    expect(isApproval(method)).toBe(false);
  });
});

describe('askOf', () => {
  describe('when it asks to run a command', () => {
    const amend = (prefix: unknown[]) => ['accept', { acceptWithExecpolicyAmendment: { execpolicy_amendment: prefix } }, 'cancel'];

    it('returns a card with the command, why, and where', () => {
      const ask = askOf('a1', COMMAND_APPROVAL, { commandActions: [{ command: 'npm test' }], command: "/bin/zsh -lc 'npm test'", reason: 'Run the tests', cwd: '/work' });
      expect(ask).toEqual({ id: 'a1', kind: 'permission', tool: 'Bash', title: 'npm test', detail: 'npm test\n\nRun the tests\n\n/work', always: null });
    });

    it('titles it by why when there is no command', () => {
      expect(askOf('a1', COMMAND_APPROVAL, { reason: 'Reach the network' })).toMatchObject({ title: 'Reach the network', detail: 'Reach the network' });
    });

    it('offers to allow from now on the commands the request names, and no more', () => {
      expect(askOf('a1', COMMAND_APPROVAL, { command: 'npm test', availableDecisions: amend(['npm', 'test']) }).always).toEqual({ rules: ['npm test'], dirs: [], mode: null });
    });

    it.each([
      ['an empty one', []],
      ['one with a part that is empty', ['npm', '']],
      ['one with a part that is not text', ['npm', 7]],
    ])('offers nothing from now on for %s', (_, prefix) => {
      expect(askOf('a1', COMMAND_APPROVAL, { command: 'npm test', availableDecisions: amend(prefix) }).always).toBeNull();
    });

    it('cuts what it says at 4000 characters', () => {
      expect(askOf('a1', COMMAND_APPROVAL, { command: 'x'.repeat(5000) }).detail).toHaveLength(4001);
    });
  });

  describe('when it asks to change files', () => {
    const fileItem = itemEventOf({ id: 'f1', type: 'fileChange', changes: [{ path: '/work/a.ts', diff: '-a\n+b' }, { path: '/work/b.ts', diff: '+c' }] });
    const files = fileItem.k === 'codex:fileChange' ? fileItem.changes : [];

    it('returns a card naming the files, with why and what changes', () => {
      expect(askOf('a1', FILE_APPROVAL, { reason: 'Fix the bug' }, files)).toEqual({
        id: 'a1',
        kind: 'permission',
        tool: 'Edit',
        title: '/work/a.ts, /work/b.ts',
        detail: 'Fix the bug\n\n-a\n+b\n+c',
        always: { rules: [], dirs: [], mode: 'acceptEdits' },
      });
    });

    it.each([
      ['the folder it would write to', { grantRoot: '/work', reason: 'Write outside' }, '/work'],
      ['why', { reason: 'Write outside' }, 'Write outside'],
    ])('titles it by %s when it names no files', (_, params, title) => {
      expect(askOf('a1', FILE_APPROVAL, params).title).toBe(title);
    });

    it.each([
      ['when it says nothing of what can be decided', {}, true],
      ['when it offers to', { availableDecisions: ['accept', 'acceptForSession', 'decline'] }, true],
      ['not when it does not', { availableDecisions: ['accept', 'decline'] }, false],
    ])('offers to allow edits for the session %s', (_, params, offers) => {
      expect(askOf('a1', FILE_APPROVAL, params, files).always !== null).toBe(offers);
    });
  });
});

describe('decisionOf', () => {
  const amendment = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['npm', 'test'] } };

  it.each<[string, string, Record<string, unknown>, Answer, unknown]>([
    ['No stops the turn', COMMAND_APPROVAL, {}, { allow: false }, 'cancel'],
    ['No stops the turn where that is offered', FILE_APPROVAL, { availableDecisions: ['accept', 'cancel', 'decline'] }, { allow: false }, 'cancel'],
    ['No declines where stopping is not offered', COMMAND_APPROVAL, { availableDecisions: ['accept', 'decline'] }, { allow: false }, 'decline'],
    ['Yes allows this once', COMMAND_APPROVAL, { availableDecisions: [amendment] }, { allow: true }, 'accept'],
    ['Yes, always, allows the commands the request names', COMMAND_APPROVAL, { availableDecisions: [amendment] }, { allow: true, always: true }, amendment],
    ['Yes, always, allows for the session a command it names none for', COMMAND_APPROVAL, {}, { allow: true, always: true }, 'acceptForSession'],
    ['Yes, always, allows edits for the session', FILE_APPROVAL, {}, { allow: true, always: true }, 'acceptForSession'],
  ])('%s', (_, method, params, answer, decision) => {
    expect(decisionOf(method, params, answer)).toEqual({ decision });
  });
});

describe('usageOf', () => {
  it('returns the model, its effort, how full the context is, and the limits used', () => {
    expect(
      usageOf({
        model: 'gpt-5-codex',
        effort: 'high',
        tokenUsage: { modelContextWindow: 200_000, last: { totalTokens: 50_500 } },
        rateLimits: { primary: { usedPercent: 12.5, resetsAt: 1_791_000_000 }, secondary: { usedPercent: 40 } },
      }),
    ).toEqual({ model: 'gpt-5-codex', effort: 'high', context: 25, fiveHour: { used: 12.5, resetsAt: 1_791_000_000 }, sevenDay: { used: 40 } });
  });

  it.each([
    ['a context past full', { tokenUsage: { modelContextWindow: 100, last: { totalTokens: 250 } } }, { context: 100 }],
    ['a limit past all of it', { rateLimits: { primary: { usedPercent: 130 } } }, { fiveHour: { used: 100 } }],
    ['a limit below none of it', { rateLimits: { secondary: { usedPercent: -5 } } }, { sevenDay: { used: 0 } }],
    ['a model with a long name', { model: 'm'.repeat(100) }, { model: 'm'.repeat(80) }],
  ])('keeps %s in bounds', (_, o, usage) => {
    expect(usageOf(o)).toEqual(usage);
  });

  it.each([
    ['nothing', {}],
    ['a context window of nothing', { tokenUsage: { modelContextWindow: 0, last: { totalTokens: 10 } } }],
    ['limits that say no use', { rateLimits: { primary: {}, secondary: { usedPercent: 'half' } } }],
    ['token counts that are not numbers', { tokenUsage: { modelContextWindow: '200000', last: { totalTokens: Number.NaN } } }],
  ])('returns nothing of %s', (_, o) => {
    expect(usageOf(o)).toBeNull();
  });
});

describe('inputOf', () => {
  const PIC = '/work/.workoffdesk/uploads/2026-10-08-101500-a1b2c3.png';

  it('sends the text, and each picture from the phone named in it as an image, once', () => {
    expect(inputOf(`look ${PIC} and "${PIC}"`)).toEqual([
      { type: 'text', text: `look ${PIC} and "${PIC}"`, text_elements: [] },
      { type: 'localImage', path: PIC },
    ]);
  });

  it('sends a picture under ~ at its place in this home', () => {
    expect(inputOf('see ~/.workoffdesk/uploads/2026-10-08-101500-a1b2c3.jpg')[1]).toEqual({ type: 'localImage', path: join(homedir(), '.workoffdesk/uploads/2026-10-08-101500-a1b2c3.jpg') });
  });

  it.each([
    ['a picture that is not from the phone', '/work/shot.png'],
    ['a file from the phone that is not a picture', '/work/.workoffdesk/uploads/2026-10-08-101500-a1b2c3.pdf'],
    ['a name like an upload outside uploads', '/work/2026-10-08-101500-a1b2c3.png'],
  ])('sends the text only, with %s', (_, path) => {
    expect(inputOf(`see ${path}`)).toEqual([{ type: 'text', text: `see ${path}`, text_elements: [] }]);
  });
});
