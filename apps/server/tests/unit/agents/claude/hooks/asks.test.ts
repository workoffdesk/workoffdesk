import { afterEach, describe, expect, it, vi } from 'vitest';
import { askedOf, HOLD_MS, leftToScreen, PermissionAsks, type HeldHook, type PermissionPayload } from '../../../../../src/agents/claude/hooks/asks.js';

// The permission prompts Claude Code's hooks hold open for the phone: each answered once, by the phone or
// the Mac, or let go when the turn moves on.
const S = 'term-1';
const hook = () => {
  const replies: (object | null)[] = [];
  const h: HeldHook & { replies: typeof replies } = { replies, reply: (o) => void replies.push(o), onGone: () => {} };
  return h;
};
const bash = (command: string, extra: PermissionPayload = {}): PermissionPayload => ({ tool_name: 'Bash', tool_input: { command, description: 'Run it' }, ...extra });
const decision = (d: object) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } });
const RULE = { type: 'addRules', behavior: 'allow', destination: 'localSettings', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }] };

const asks = () => {
  const changed: string[] = [];
  return { a: new PermissionAsks((id) => changed.push(id)), changed };
};
afterEach(() => vi.useRealTimers());

describe('PermissionAsks', () => {
  describe('hold', () => {
    it('shows it as a card of the tool, what it would do, and what From now on allows', () => {
      const { a, changed } = asks();
      const h = hook();
      const ask = a.hold(S, bash('npm test', { permission_suggestions: [RULE, 'not a suggestion'] }), h);
      expect(ask).toEqual({ id: expect.any(String), kind: 'permission', tool: 'Bash', title: 'Run it', detail: 'npm test', always: { rules: ['Bash(npm test:*)'], dirs: [], mode: null } });
      expect(a.list(S)).toEqual([ask]);
      expect(a.list('term-2')).toEqual([]);
      expect(changed).toEqual([S]);
      expect(h.replies).toEqual([]);
    });

    it.each<[string, PermissionPayload]>([
      ["Claude's question", { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which?' }] } }],
      ["Claude's plan", { tool_name: 'ExitPlanMode', tool_input: { plan: 'Do it' } }],
      ['no tool', { tool_input: {} }],
      ['a tool that is not a name', { tool_name: 7, tool_input: {} }],
      ['no input', { tool_name: 'Bash' }],
      ['an input that is a list', { tool_name: 'Bash', tool_input: ['ls'] }],
    ])('does not hold it when it is %s: the hook is answered with nothing, and the dialog left to the Mac', (_, payload) => {
      const { a, changed } = asks();
      const h = hook();
      expect(a.hold(S, payload, h)).toBeNull();
      expect(h.replies).toEqual([null]);
      expect([a.list(S), changed]).toEqual([[], []]);
    });

    describe('the card', () => {
      it.each<[string, PermissionPayload, string]>([
        ['a command, whole', bash('npm test && npm run build'), 'npm test && npm run build'],
        ['a file written, its content', { tool_name: 'Write', tool_input: { file_path: '/work/a.ts', content: 'export {};\n' } }, 'export {};\n'],
        ['a change, the lines it takes out and puts in', { tool_name: 'Edit', tool_input: { file_path: '/work/a.ts', old_string: 'a\nb', new_string: 'c' } }, '- a\n- b\n+ c'],
        ['any other tool, what it is given', { tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } }, '{\n  "url": "https://example.com"\n}'],
      ])('shows %s', (_, payload, detail) => {
        expect(asks().a.hold(S, payload, hook())?.detail).toBe(detail);
      });

      it('shows no more of it than a card has room for', () => {
        const detail = asks().a.hold(S, bash('x'.repeat(5000)), hook())!.detail;
        expect(detail).toBe(`${'x'.repeat(4000)}…`);
        expect(asks().a.hold(S, bash('x'.repeat(4000)), hook())!.detail).toBe('x'.repeat(4000));
      });

      it.each<[string, unknown[], unknown]>([
        ['rules, folders and a mode', [RULE, { type: 'addRules', behavior: 'allow', rules: [{ toolName: 'WebSearch' }] }, { type: 'addDirectories', directories: ['/work/other', 3] }, { type: 'setMode', mode: 'acceptEdits' }], { rules: ['Bash(npm test:*)', 'WebSearch'], dirs: ['/work/other'], mode: 'acceptEdits' }],
        ['a rule it cannot read', [{ type: 'addRules', behavior: 'allow', rules: ['Bash', { toolName: 'Read' }] }], { rules: ['Read'], dirs: [], mode: null }],
        ['a folder only', [{ type: 'addDirectories', directories: ['/work/other'] }], { rules: [], dirs: ['/work/other'], mode: null }],
        ['a mode only', [{ type: 'setMode', mode: 'acceptEdits' }], { rules: [], dirs: [], mode: 'acceptEdits' }],
        ['a mode with no name', [RULE, { type: 'setMode', mode: '' }], null],
        ['nothing at all', [], null],
        ['a kind it cannot name', [RULE, { type: 'replaceRules', rules: [] }], null],
        ['a rule that denies', [{ type: 'addRules', behavior: 'deny', rules: [{ toolName: 'Bash' }] }], null],
        ['nothing it would change', [{ type: 'addDirectories', directories: [] }, { type: 'addRules', behavior: 'allow', rules: [] }], null],
      ])('says what From now on allows when Claude Code suggests %s', (_, suggestions, always) => {
        expect(asks().a.hold(S, bash('npm test', { permission_suggestions: suggestions }), hook())?.always).toEqual(always);
      });
    });
  });

  describe('answer', () => {
    it.each<[string, Parameters<PermissionAsks['answer']>[2], object]>([
      ['Yes', { allow: true }, { behavior: 'allow' }],
      ['Yes, and from now on', { allow: true, always: true }, { behavior: 'allow', updatedPermissions: [RULE] }],
      ['No, which stops the turn', { allow: false }, { behavior: 'deny', message: 'The user declined this from their phone.', interrupt: true }],
    ])('sends %s to the hook, once', (_, answer, d) => {
      const { a, changed } = asks();
      const h = hook();
      const ask = a.hold(S, bash('npm test', { permission_suggestions: [RULE] }), h)!;
      expect(a.answer(S, ask.id, answer)).toBe(true);
      expect(h.replies).toEqual([decision(d)]);
      expect(a.list(S)).toEqual([]);
      expect(changed).toEqual([S, S]);
      expect(a.answer(S, ask.id, answer)).toBe(false);
      expect(a.gone(S, ask.id)).toBe(false);
      a.endAll(S);
      expect(h.replies).toHaveLength(1);
      expect(changed).toEqual([S, S]);
    });

    it('allows from now on nothing when Claude Code suggested nothing', () => {
      const { a } = asks();
      const h = hook();
      const ask = a.hold(S, bash('npm test'), h)!;
      expect(ask.always).toBeNull();
      a.answer(S, ask.id, { allow: true, always: true });
      expect(h.replies).toEqual([decision({ behavior: 'allow' })]);
    });

    it("goes to the prompt it was given for, and not to another session's", () => {
      const { a } = asks();
      const one = hook();
      const two = hook();
      const first = a.hold(S, bash('npm test'), one)!;
      const second = a.hold(S, bash('npm run build'), two)!;
      expect(a.answer('term-2', first.id, { allow: true })).toBe(false);
      expect(a.answer(S, second.id, { allow: false })).toBe(true);
      expect([one.replies, a.list(S)]).toEqual([[], [first]]);
    });
  });

  describe('when the phone does not answer', () => {
    it('lets it go once the tool ran: allowed at the Mac, however the input was ordered', () => {
      const { a } = asks();
      const h = hook();
      const other = hook();
      a.hold(S, { tool_name: 'Edit', tool_input: { file_path: '/work/a.ts', old_string: 'a', new_string: 'b', also: [{ x: 1, y: 2 }] } }, h);
      a.hold(S, bash('ls'), other);
      a.toolDone(S, 'Edit', { also: [{ y: 2, x: 1 }], new_string: 'b', old_string: 'a', file_path: '/work/a.ts' });
      expect(h.replies).toEqual([null]);
      expect(a.list(S).map((x) => x.tool)).toEqual(['Bash']);
      a.toolDone(S, 'Edit', { file_path: '/work/a.ts', old_string: 'a', new_string: 'c' });
      a.toolDone(S, 'Bash', ['ls']);
      a.toolDone(S, 7, { command: 'ls', description: 'Run it' });
      expect(other.replies).toEqual([]);
    });

    it('ends it when the hook ended without a word from here: Claude Code stopped it', () => {
      const { a } = asks();
      const h = hook();
      const ask = a.hold(S, bash('npm test'), h)!;
      expect(a.gone(S, ask.id)).toBe(true);
      expect(a.gone(S, ask.id)).toBe(false);
      expect(a.answer(S, ask.id, { allow: true })).toBe(false);
      expect(h.replies).toEqual([]);
    });

    it('lets it go with the rest of the session when the turn is over, and only then', () => {
      const { a, changed } = asks();
      const hooks = [hook(), hook(), hook()];
      a.hold(S, bash('a'), hooks[0]);
      a.hold(S, bash('b'), hooks[1]);
      a.hold('term-2', bash('c'), hooks[2]);
      changed.length = 0;
      a.endAll(S);
      expect(hooks.map((h) => h.replies)).toEqual([[null], [null], []]);
      expect([a.list(S), a.list('term-2').length, changed]).toEqual([[], 1, [S]]);
      a.endAll(S);
      expect(changed).toEqual([S]);
    });

    it('lets it go before its hook would be stopped, which would read as No at the Mac', () => {
      vi.useFakeTimers();
      const { a } = asks();
      const h = hook();
      a.hold(S, bash('npm test'), h);
      vi.advanceTimersByTime(HOLD_MS - 1);
      expect(h.replies).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(h.replies).toEqual([null]);
      expect(a.list(S)).toEqual([]);
      expect(HOLD_MS).toBeLessThan(3600_000);
    });

    it.each<[string, (a: PermissionAsks, id: string) => void]>([
      ['answered', (a, id) => a.answer(S, id, { allow: true })],
      ['gone', (a, id) => a.gone(S, id)],
      ['let go with the turn', (a) => a.endAll(S)],
    ])('does not let it go again once %s', (_, end) => {
      vi.useFakeTimers();
      const { a } = asks();
      const h = hook();
      const ask = a.hold(S, bash('npm test'), h)!;
      end(a, ask.id);
      const replies = h.replies.length;
      vi.advanceTimersByTime(HOLD_MS);
      expect(h.replies).toHaveLength(replies);
    });
  });
});

describe('askedOf and leftToScreen', () => {
  it.each<[string, PermissionPayload, string]>([
    ["Claude's first question", { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which one?' }, { question: 'And?' }] } }, 'Which one?'],
    ['a question with none', { tool_name: 'AskUserQuestion', tool_input: { questions: [] } }, ''],
    ["Claude's plan", { tool_name: 'ExitPlanMode', tool_input: { plan: '1. Do it' } }, '1. Do it'],
    ['a tool and what it would do', bash('npm test'), 'Bash Run it'],
    ['nothing', {}, ''],
    ['nothing, when it names no tool', { tool_input: { command: 'ls' } }, ''],
  ])('returns %s', (_, payload, said) => {
    expect(askedOf(payload)).toBe(said);
  });

  it('leaves only a question or a plan to the screen', () => {
    expect([leftToScreen({ tool_name: 'AskUserQuestion' }), leftToScreen({ tool_name: 'ExitPlanMode' }), leftToScreen({ tool_name: 'Bash' }), leftToScreen({})]).toEqual([true, true, false, false]);
  });
});
