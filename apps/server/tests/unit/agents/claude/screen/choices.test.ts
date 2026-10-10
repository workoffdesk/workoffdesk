import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { keysToChoose, keysToTick, parseChoices } from '../../../../../src/agents/claude/screen/choices.js';

// Screens captured from Claude Code v2.1.288 with `tmux capture-pane -p`.
const screen = (name: string) => readFileSync(new URL(`../../../../fixtures/screens/${name}.txt`, import.meta.url), 'utf8');

// Written by hand: a real one needs Claude to call a tool, which costs a model turn.
const permission = `
 Bash command

   rm -rf build
   Remove the build directory

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for rm commands in /Users/alice/p
   3. No, and tell Claude what to do differently (esc)

 Esc to cancel · Tab to amend
`;

// Written by hand from how Claude Code v2.1.288 draws a question with multiSelect (its binary): a box
// before each option, ticked with ✔, an answer of one's own last, and a Submit (Next while more questions
// follow) under them. Asking for a real one costs a model turn.
const several = (o: { at?: number; submit?: string } = {}) => {
  const rows = [
    ['1. [ ] Lint', '   fast'],
    ['2. [✔] Types', '   tsc --noEmit'],
    ['3. [ ] Tests', '   slow'],
    ['4. [ ] Type something…', null],
  ];
  const at = o.at ?? 0;
  const lines = rows.flatMap(([row, more], i) => [`${i === at ? '❯ ' : '  '}${row}`, ...(more ? [`  ${more}`] : [])]);
  return [
    '────────────────────────────────────────',
    ' ☐ 检查  ✓ Submit',
    '',
    '要跑哪些检查？',
    '',
    ...lines,
    '',
    `   ${at === rows.length ? '❯ ' : ''}${o.submit ?? 'Submit'}`,
    '',
    'Enter to select · ↑/↓ to navigate · Esc to cancel',
    '',
  ].join('\n');
};

// Written by hand from the strings the parser looks for: a real /rewind needs a conversation with turns in it.
// Each message to go back to before is a block, a blank line apart, its first line the message.
const rewind = (o: { at?: number; hint?: string; entries?: string[][] } = {}) => {
  const entries = o.entries ?? [['(current)'], ['Where are the docs for the login change?', 'No code changes'], ['Fix the build', 'src/app.ts +3 -1', 'src/main.ts +1']];
  const at = o.at ?? 1;
  return [
    '────────────────────────────────────────────────────────────',
    ' Rewind',
    '',
    ' Restore the code and/or conversation to the point before…',
    '',
    ...entries.flatMap(([first, ...rest], i) => [`${i === at ? ' ❯ ' : '   '}${first}`, ...rest.map((l) => `   ${l}`), '']),
    o.hint ?? ' Enter to continue · Esc to exit',
    '',
  ].join('\n');
};

// The row of tabs over several questions asked at once, as Claude Code v2.1.289 drew it at 60 columns (the
// capture lost its blank lines; they are put back where ask-user-question.txt has them).
const twoQuestions = (tabs: string) =>
  [
    '────────────────────────────────────────────────────────────',
    tabs,
    '',
    'Pick fruits',
    '',
    '❯ 1. [ ] apple',
    '         apple',
    '  2. [ ] pear',
    '         pear',
    '  3. [ ] plum',
    '         plum',
    '  4. [ ] Type something',
    '     Submit',
    '────────────────────────────────────────────────────────────',
    '  5. Chat about this',
    '',
    'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
    '',
  ].join('\n');

describe('parseChoices', () => {
  it('reads an unnumbered choice, with what it asks about', () => {
    const c = parseChoices(screen('trust-folder'))!;
    expect(c.options).toEqual([
      { label: 'No, exit', detail: '' },
      { label: 'Yes, I trust this folder', detail: '' },
    ]);
    expect(c.cursor).toBe(0);
    expect(c.context).toMatch(/^Accessing workspace:\n\n\/private\/tmp\//);
    expect(c.context).toMatch(/Security guide$/);
  });

  it('reads a numbered list whose descriptions wrap, up to where it scrolls on', () => {
    const c = parseChoices(screen('model-picker'))!;
    expect(c.options.map((o) => o.label)).toEqual(['Default (recommended) ✔', 'Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 4.5', 'Sonnet 5']);
    expect(c.options[0].detail).toBe('Opus 5.5 · Best for everyday, complex tasks');
    expect(c.options[5].detail).toBe('Efficient for routine tasks');
    expect(c.context).toMatch(/^Select model\n/);
  });

  it('reads a question Claude asks, with each option\'s description, up to the rule under it', () => {
    const c = parseChoices(screen('ask-user-question'))!;
    expect(c.options).toEqual([
      { label: 'Run tests first', detail: 'safest' },
      { label: 'Ship now', detail: 'fastest' },
      { label: 'Wait until Monday', detail: 'Wait until Monday' },
      { label: 'Type something.', detail: '', typed: true },
    ]);
    expect(c.cursor).toBe(0);
    expect(c.context).toBe('☐ 部署方案\n\n你更倾向哪个部署方案？');
  });

  it('reads a permission prompt', () => {
    const c = parseChoices(permission)!;
    expect(c.options.map((o) => o.label)).toEqual([
      'Yes',
      "Yes, and don't ask again for rm commands in /Users/alice/p",
      'No, and tell Claude what to do differently (esc)',
    ]);
    expect(c.context).toBe('Bash command\n\n  rm -rf build\n  Remove the build directory\n\nDo you want to proceed?');
  });

  it('takes only lines in the options\' column as options', () => {
    expect(parseChoices(' ❯ Yes\n   No\nx  not an option\n')!.options.map((o) => o.label)).toEqual(['Yes', 'No']);
  });

  it('keeps what it is about to the last screenful of lines, without runs of blank lines', () => {
    const long = Array.from({ length: 20 }, (_, i) => ` line ${i}`).join('\n');
    const c = parseChoices(`${long}\n\n\n\n ❯ Yes\n   No\n`)!;
    expect(c.context.split('\n')[0]).toBe('line 8');
    expect(c.context).toMatch(/line 19$/);
    expect(parseChoices(' Sure?\n\n\n\n Really?\n ❯ Yes\n   No\n')!.context).toBe('Sure?\n\nReally?');
  });

  it('knows where the cursor is', () => {
    const moved = permission.replace(' ❯ 1. Yes', '   1. Yes').replace('   2. Yes,', ' ❯ 2. Yes,');
    expect(parseChoices(moved)!.cursor).toBe(1);
  });

  it.each([
    ['the prompt waiting for input, under earlier prompts in the scrollback', screen('idle-input')],
    ['the prompt and status bar after a question was answered', screen('idle-after-answer')],
    ['a screen with no cursor', ' 1. one\n 2. two\n'],
    ['a choice of several at once with no Submit to be seen, so it could not be sent', ' Pick some\n ❯ [ ] Alpha\n   [ ] Beta\n'],
    ['an empty screen', ''],
    ['a cursor on a Submit under options with no boxes', '  1. Yes\n  2. No\n\n   ❯ Submit\n'],
    ['a single option, which is no choice', ' Pick\n ❯ Only\n'],
    ['a cursor on something that is not an option', ' ❯ … +3 more\n   Beta\n   Gamma\n'],
  ])('finds nothing on %s', (_, s) => {
    expect(parseChoices(s)).toBeNull();
  });

  describe('with several to tick', () => {
    it('reads each option with whether it is ticked, the answer of one\'s own, and what sends them', () => {
      const c = parseChoices(several())!;
      expect(c.options).toEqual([
        { label: 'Lint', detail: 'fast', ticked: false },
        { label: 'Types', detail: 'tsc --noEmit', ticked: true },
        { label: 'Tests', detail: 'slow', ticked: false },
        { label: 'Type something…', detail: '', ticked: false, typed: true },
      ]);
      expect(c.submit).toBe('Submit');
      expect(c.cursor).toBe(0);
      expect(c.context).toBe('☐ 检查  ✓ Submit\n\n要跑哪些检查？');
    });

    it('knows the cursor on an option further down, and on Submit itself', () => {
      expect(parseChoices(several({ at: 2 }))!.cursor).toBe(2);
      const c = parseChoices(several({ at: 4 }))!;
      expect(c.cursor).toBe(4);
      expect(c.options.map((o) => o.label)).toEqual(['Lint', 'Types', 'Tests', 'Type something…']);
    });

    it('finds Submit right under the options too, with no blank line between', () => {
      for (const at of [0, 4]) {
        const c = parseChoices(several({ at }).replace(/\n\n( {3}(❯ )?Submit)/, '\n$1'))!;
        expect(c.submit).toBe('Submit');
        expect(c.options[3]).toEqual({ label: 'Type something…', detail: '', ticked: false, typed: true });
      }
    });

    it('finds nothing when the Submit under the options is further off than a blank line or a rule', () => {
      expect(parseChoices(several().replace('\n\n   Submit', '\n\n Something else\n   Submit'))).toBeNull();
    });

    it('calls it Next while more questions follow', () => {
      expect(parseChoices(several({ submit: 'Next' }))!.submit).toBe('Next');
    });

    it('takes √ for a tick too, as it is drawn where ✔ is not', () => {
      expect(parseChoices(several().replace('[✔]', '[√]'))!.options[1].ticked).toBe(true);
    });

    it('leaves a choice of one as it was: no ticks, no Submit', () => {
      expect(parseChoices(permission)).not.toHaveProperty('submit');
      expect(parseChoices(permission)!.options[0]).not.toHaveProperty('ticked');
    });
  });

  describe('on /rewind', () => {
    it('offers each message to go back to before, with what changed since, as a picker the person opened', () => {
      expect(parseChoices(rewind())).toEqual({
        opened: true,
        context: 'Restore the code and/or conversation to the point before…',
        options: [
          { label: '(current)', detail: '' },
          { label: 'Where are the docs for the login change?', detail: 'No code changes' },
          { label: 'Fix the build', detail: 'src/app.ts +3 -1 src/main.ts +1' },
        ],
        cursor: 1,
      });
    });

    it('knows the cursor on any of them', () => {
      expect(parseChoices(rewind({ at: 0 }))!.cursor).toBe(0);
      expect(parseChoices(rewind({ at: 2 }))!.cursor).toBe(2);
    });

    it('takes the marks of a list scrolled off either end out of the message', () => {
      const scrolled = rewind().replace('   (current)', ' ↑ (current)').replace('   Fix the build', ' ↓ Fix the build');
      expect(parseChoices(scrolled)!.options.map((o) => o.label)).toEqual(['(current)', 'Where are the docs for the login change?', 'Fix the build']);
    });

    it('reads the last one on the screen, when an earlier one is still in the scrollback', () => {
      const earlier = rewind({ entries: [['(current)'], ['Old question']], at: 0, hint: ' Enter to continue · Esc to exit' });
      expect(parseChoices(`${earlier}\n❯ /rewind\n${rewind({ at: 2 })}`)!.cursor).toBe(2);
    });

    it.each<[string, string]>([
      ['it has only one message', rewind({ entries: [['(current)']], at: 0 })],
      ['none of them is under the cursor', rewind({ at: 9 })],
    ])('is nothing to pick when %s', (_, screen) => {
      expect(parseChoices(screen)).toBeNull();
    });

    it('is not the picker until its key hint is drawn under it', () => {
      const c = parseChoices(rewind({ hint: '' }));
      expect(c?.opened).toBeUndefined();
      expect(c?.options).not.toHaveLength(3);
    });
  });

  describe('with several questions asked at once', () => {
    it.each<[string, string]>([
      ['←  ☒ Color  ☐ Fruits  ✔ Submit  →', '✓ Color · ○ Fruits'],
      ['←  ☒ Color  ☒ Fruits  ✔ Submit  →', '✓ Color · ✓ Fruits'],
      ['←  ☐ Color  ☐ Fruits  ☐ Pick a size  ✔ Submit  →', '○ Color · ○ Fruits · ○ Pick a size'],
    ])('says which are answered over the question asked now (%s)', (tabs, said) => {
      expect(parseChoices(twoQuestions(tabs))!.context).toBe(`${said}\n\nPick fruits`);
    });

    it('says the last question with nothing after it but the arrow', () => {
      expect(parseChoices(twoQuestions('←  ☒ Color  ☐ Fruits →'))!.context).toBe('✓ Color · ○ Fruits\n\nPick fruits');
    });

    it('leaves a row that is not one of tabs as it is', () => {
      expect(parseChoices(twoQuestions('☒ Color  ☐ Fruits'))!.context).toBe('☒ Color  ☐ Fruits\n\nPick fruits');
    });
  });
});

describe('keysToChoose', () => {
  const opt = (label: string) => ({ label, detail: '' });
  it.each([
    [0, 0, '\r'],
    [0, 2, '\x1b[B\x1b[B\r'],
    [2, 1, '\x1b[A\r'],
  ])('moves from %i to %i and confirms', (from, to, keys) => {
    expect(keysToChoose({ context: '', options: [opt('a'), opt('b'), opt('c')], cursor: from }, to)).toBe(keys);
  });

  it('only moves onto an answer to be typed: Enter there would send it empty, which declines the question', () => {
    const c = { context: '', options: [opt('a'), { ...opt('Type something.'), typed: true as const }], cursor: 0 };
    expect(keysToChoose(c, 1)).toBe('\x1b[B');
  });
});

describe('keysToTick', () => {
  const SPACE = ' ';
  const D = '\x1b[B';
  const U = '\x1b[A';
  const c = (ticked: boolean[], cursor = 0) => ({
    context: '',
    options: [
      ...ticked.map((t, i) => ({ label: `o${i}`, detail: '', ticked: t })),
      { label: 'Type something…', detail: '', ticked: false, typed: true as const },
    ],
    cursor,
    submit: 'Submit',
  });

  it('presses Space on each option that has to change, then goes down past the last to Submit and sends', () => {
    expect(keysToTick(c([false, true, false]), [0, 2])).toBe(`${SPACE}${D}${SPACE}${D}${SPACE}${D}${D}\r`);
  });

  it('touches nothing that is already as wanted', () => {
    expect(keysToTick(c([true, false, false]), [0])).toBe(`${D}${D}${D}${D}\r`);
  });

  it('starts from where the cursor is, Submit included', () => {
    expect(keysToTick(c([false, false, false], 4), [1])).toBe(`${U}${U}${U}${SPACE}${D}${D}${D}\r`);
    expect(keysToTick(c([false, false, false], 4), [])).toBe('\r');
  });
});
