import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keysToTick, parseChoices, type Choices } from '../../../../../src/agents/claude/screen/choices.js';
import { liveText } from '../../../../../src/agents/claude/screen/live.js';
import { ClaudeScreen } from '../../../../../src/agents/claude/screen/screen.js';
import type { Tmux } from '../../../../../src/system/tmux.js';

// Claude Code's screen in tmux, read for the phone and answered by keys: a key goes to the TUI only while
// it still shows what the phone was shown.
const screenOf = (name: string) => readFileSync(new URL(`../../../../fixtures/screens/${name}.txt`, import.meta.url), 'utf8');
const QUESTION = screenOf('ask-user-question');
const DOWN = '\x1b[B';
const COLS = 80;

// What is on screen can be changed between reads (`shown`); `did` is what was read beyond the screen, and sent.
const tmux = (o: { screen?: string; styled?: string | Error | (() => string); joined?: string; cols?: number | Error } = {}) => {
  const did: string[] = [];
  const t = {
    did,
    shown: o.screen ?? QUESTION,
    screen: async () => t.shown,
    screenAndAbove: async (_: string, lines: number) => (did.push(`above ${lines}`), { screen: t.shown, above: '' }),
    screenStyled: async () => {
      if (o.styled instanceof Error) throw o.styled;
      return typeof o.styled === 'function' ? o.styled() : (o.styled ?? '');
    },
    screenJoined: async () => (did.push('joined'), o.joined ?? ''),
    windowSize: async () => {
      did.push('size');
      if (o.cols instanceof Error) throw o.cols;
      return { cols: o.cols ?? COLS, rows: 40 };
    },
    leaveCopyMode: async (name: string) => void did.push(`leave ${name}`),
    sendRaw: async (name: string, keys: string) => void did.push(`keys ${name} ${JSON.stringify(keys)}`),
    paste: async (name: string, text: string) => void did.push(`paste ${name} ${text}`),
  };
  return t;
};
const claude = (t: ReturnType<typeof tmux>) => new ClaudeScreen(t as unknown as Tmux, COLS);

// A question that takes several answers, drawn as Claude Code v2.1.288 draws one (as in choices.test.ts).
const SEVERAL = [
  '────────────────────────────────────────',
  ' ☐ 检查  ✓ Submit',
  '',
  '要跑哪些检查？',
  '',
  '❯ 1. [ ] Lint',
  '     fast',
  '  2. [✔] Types',
  '     tsc --noEmit',
  '  3. [ ] Tests',
  '     slow',
  '  4. [ ] Type something…',
  '',
  '   Submit',
  '',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
  '',
].join('\n');
const LABELS = ['Lint', 'Types', 'Tests', 'Type something…'];

describe('ClaudeScreen', () => {
  describe('choose', () => {
    it('moves to it from where the cursor is and takes it, out of copy mode first', async () => {
      const t = tmux();
      expect(await claude(t).choose('s1', 1, 'Ship now')).toBe(true);
      expect(t.did).toEqual(['leave s1', `keys s1 ${JSON.stringify(`${DOWN}\r`)}`]);
    });

    it.each<[string, number, string]>([
      ['another option is there now', 1, 'Run tests first'],
      ['there is no such option', 9, 'Ship now'],
    ])('sends nothing when %s: the screen moved on since the phone was shown it', async (_, index, label) => {
      const t = tmux();
      expect(await claude(t).choose('s1', index, label)).toBe(false);
      expect(t.did).toEqual([]);
    });

    it('sends nothing once the question is gone', async () => {
      const t = tmux({ screen: screenOf('idle-input') });
      expect(await claude(t).choose('s1', 1, 'Ship now')).toBe(false);
      expect(t.did).toEqual([]);
    });

    it('reads the screen as it is when the answer comes', async () => {
      const t = tmux();
      const c = claude(t);
      expect(await c.choices('s1')).toMatchObject({ options: [{ label: 'Run tests first' }, { label: 'Ship now' }, { label: 'Wait until Monday' }, { label: 'Type something.' }] });
      t.shown = screenOf('idle-input');
      expect(await c.choose('s1', 1, 'Ship now')).toBe(false);
    });

    it("types an answer of one's own into its field, moved onto but not taken empty", async () => {
      const t = tmux();
      expect(await claude(t).choose('s1', 3, 'Type something.', undefined, 'After the release')).toBe(true);
      expect(t.did).toEqual(['leave s1', `keys s1 ${JSON.stringify(DOWN.repeat(3))}`, 'paste s1 After the release']);
    });

    it("sends nothing for an answer of one's own to an option that takes none", async () => {
      const t = tmux();
      expect(await claude(t).choose('s1', 1, 'Ship now', undefined, 'Ship it')).toBe(false);
      expect(t.did).toEqual([]);
    });

    it('reads the options the way it is told to, for a TUI drawn like Claude Code', async () => {
      const t = tmux({ screen: 'their screen' });
      const seen: string[] = [];
      const theirs = (screen: string): Choices => (seen.push(screen), { context: '', options: [{ label: 'Yes', detail: '' }, { label: 'No', detail: '' }], cursor: 1, take: 's' });
      expect(await claude(t).choose('s1', 0, 'Yes', theirs)).toBe(true);
      expect(seen).toEqual(['their screen']);
      expect(t.did).toEqual(['leave s1', `keys s1 ${JSON.stringify('\x1b[As')}`]);
    });
  });

  describe('toBackground', () => {
    const FOREGROUND = screenOf('foreground-command');
    const sent = (t: ReturnType<typeof tmux>) => t.did.filter((d) => /^(keys|leave) /.test(d));

    it('presses ctrl+b once, out of copy mode first, while Claude Code offers it', async () => {
      const t = tmux({ screen: screenOf('idle-input'), joined: FOREGROUND });
      expect(await claude(t).toBackground('s1')).toBe(true);
      expect(sent(t)).toEqual(['leave s1', `keys s1 ${JSON.stringify('\x02')}`]);
    });

    it('presses nothing once the command is over and the offer gone', async () => {
      const t = tmux({ screen: screenOf('idle-input'), joined: screenOf('idle-input') });
      expect(await claude(t).toBackground('s1')).toBe(false);
      expect(sent(t)).toEqual([]);
    });

    it('presses nothing while a choice has the keyboard, which the key would go to', async () => {
      const t = tmux({ joined: FOREGROUND });
      expect(await claude(t).toBackground('s1')).toBe(false);
      expect(sent(t)).toEqual([]);
    });
  });

  describe('tick', () => {
    it('ticks what is to be ticked, unticks the rest, and sends them', async () => {
      const t = tmux({ screen: SEVERAL });
      expect(await claude(t).tick('s1', [0, 2], LABELS)).toBe(true);
      expect(t.did).toEqual(['leave s1', `keys s1 ${JSON.stringify(keysToTick(parseChoices(SEVERAL)!, [0, 2]))}`]);
    });

    it.each<[string, string, number[], string[]]>([
      ['the options are others now', SEVERAL, [0], ['Lint', 'Types', 'Build', 'Type something…']],
      ['there are more options now', SEVERAL, [0], LABELS.slice(0, 3)],
      ['there are fewer options now', SEVERAL, [0], [...LABELS, 'Build']],
      ['the question takes one answer', QUESTION, [0], ['Run tests first', 'Ship now', 'Wait until Monday', 'Type something.']],
      ['there is no question', screenOf('idle-input'), [0], LABELS],
      ['it would tick an option there is not', SEVERAL, [4], LABELS],
      ["it would tick the answer of one's own, where Space is typed", SEVERAL, [0, 3], LABELS],
    ])('sends nothing when %s', async (_, screen, ticked, labels) => {
      const t = tmux({ screen });
      expect(await claude(t).tick('s1', ticked, labels)).toBe(false);
      expect(t.did).toEqual([]);
    });
  });

  describe('read', () => {
    it('returns the choice asked for, with nothing read of what Claude writes while it waits', async () => {
      const t = tmux();
      const { screen, compacting } = await claude(t).read('s1', false);
      expect(screen.choices?.options.map((o) => o.label)).toEqual(['Run tests first', 'Ship now', 'Wait until Monday', 'Type something.']);
      expect([screen.panel, screen.live, compacting]).toEqual([null, null, false]);
      expect(t.did).toEqual(['above 200']);
    });

    // A reply Claude broke into two lines to fit 80 columns: on a narrower window the break is the terminal's.
    const WRITING = ['⏺ The finished form has no marker. I need the in-progress form, so', "  I'll record my own pane:", '', '─'.repeat(40), '❯ ', '─'.repeat(40)].join('\n');

    it('returns what Claude is writing while it works, wrapped at the width of its window', async () => {
      expect(liveText(WRITING, 70)).toBe("The finished form has no marker. I need the in-progress form, so I'll record my own pane:");
      expect(liveText(WRITING, COLS)).toContain('\n');
      const t = tmux({ screen: screenOf('idle-input'), joined: WRITING, cols: 70 });
      const { screen } = await claude(t).read('s1', true);
      expect(screen.live).toBe(liveText(WRITING, 70));
      expect(t.did.sort()).toEqual(['above 200', 'joined', 'size']);
    });

    it("wraps it at the width it was given when the window's cannot be read", async () => {
      const { screen } = await claude(tmux({ screen: screenOf('idle-input'), joined: WRITING, cols: new Error('gone') })).read('s1', true);
      expect(screen.live).toBe(liveText(WRITING, COLS));
    });

    it('returns no live text while a choice is asked for, even as Claude works', async () => {
      expect(liveText(WRITING, COLS)).not.toBeNull();
      const { screen } = await claude(tmux({ joined: WRITING })).read('s1', true);
      expect(screen.choices).not.toBeNull();
      expect(screen.live).toBeNull();
    });

    it('returns no live text while a dialog is open over the prompt, even as Claude works', async () => {
      const { screen } = await claude(tmux({ screen: screenOf('settings-usage'), joined: WRITING })).read('s1', true);
      expect([screen.choices, screen.panel === null, screen.live]).toEqual([null, false, null]);
    });

    describe('the offer to send the command at work to the background', () => {
      const FOREGROUND = screenOf('foreground-command');

      it('is read off the joined screen while Claude works', async () => {
        const { screen } = await claude(tmux({ screen: screenOf('idle-input'), joined: FOREGROUND })).read('s1', true);
        expect(screen.background).toBe(true);
      });

      it('is not there while Claude does not work, nor when its screen does not offer it', async () => {
        expect((await claude(tmux({ screen: FOREGROUND, joined: FOREGROUND })).read('s1', false)).screen.background).toBe(false);
        expect((await claude(tmux({ screen: screenOf('idle-input'), joined: screenOf('idle-input') })).read('s1', true)).screen.background).toBe(false);
      });

      it('is not there while a choice or a dialog has the keyboard', async () => {
        expect((await claude(tmux({ joined: FOREGROUND })).read('s1', true)).screen.background).toBe(false);
        expect((await claude(tmux({ screen: screenOf('settings-usage'), joined: FOREGROUND })).read('s1', true)).screen.background).toBe(false);
      });
    });

    it('reads the screen still when the styled screen cannot be', async () => {
      const { screen } = await claude(tmux({ screen: screenOf('idle-input'), styled: new Error('gone') })).read('s1', false);
      expect(screen.suggestion).toBeNull();
    });

    it('says when Claude is compacting', async () => {
      expect((await claude(tmux({ screen: screenOf('compacting') })).read('s1', false)).compacting).toBe(true);
    });

    describe('when the choice is to go ahead with a plan', () => {
      const plan = (file: string) =>
        [
          'Would you like to proceed?',
          '',
          '❯ 1. Yes, and auto-accept edits',
          '  2. Yes, and manually approve edits',
          '  3. No, keep planning',
          '',
          `ctrl-g to edit in Vim · ~/.claude/plans/${file}`,
          '',
        ].join('\n');
      const plans = join(homedir(), '.claude', 'plans');

      it("returns the plan it names, read from Claude Code's plans folder, as much as the phone is sent", async () => {
        mkdirSync(plans, { recursive: true });
        writeFileSync(join(plans, 'quiet-river.md'), `# Plan\n${'x'.repeat(30_000)}`);
        const c = await claude(tmux({ screen: plan('quiet-river.md') })).read('s1', false);
        expect(c.screen.choices).toMatchObject({ planFile: 'quiet-river.md', plan: `# Plan\n${'x'.repeat(20_000 - 7)}` });
      });

      it('returns the choice without it when there is no such plan', async () => {
        const c = await claude(tmux({ screen: plan('no-such-plan.md') })).read('s1', false);
        expect(c.screen.choices).toMatchObject({ planFile: 'no-such-plan.md' });
        expect(c.screen.choices).not.toHaveProperty('plan');
      });
    });
  });
});

// The prompt as Claude Code v2.1.296 draws it, styled as tmux captures it: what is typed is plain, a hint or
// a suggestion dimmed.
const RULE = `\x1b[38;5;245m${'─'.repeat(40)}`;
const promptShowing = (...lines: string[]) =>
  ['\x1b[38;5;241m\x1b[48;5;255m❯ \x1b[38;5;16man earlier prompt\x1b[39m', '', RULE, ...lines, RULE, '\x1b[39m  \x1b[38;5;241mOpus 5.5\x1b[39m', ''].join('\n');
const EMPTY = promptShowing('\x1b[39m❯\xa0');
const HINT = promptShowing('\x1b[39m❯\xa0\x1b[2mTry\x1b[0m \x1b[2m"how\x1b[0m \x1b[2mdoes\x1b[0m \x1b[2mit\x1b[0m \x1b[2mwork?"\x1b[0m');
const SUGGESTED = promptShowing('\x1b[39m❯\xa0\x1b[2m给列表也加上上报\x1b[0m');
const TYPED = promptShowing('\x1b[39m❯\xa015301765876 这个');
const TYPED_LINES = promptShowing('\x1b[39m❯\xa0draft one', '  second line');

describe('clearPrompt', () => {
  const STASH = '\x13';
  // The screen as tmux gives it plain and styled, both from what `shown` says now.
  const prompt = (shown: () => string) => {
    const t = tmux({ styled: shown });
    t.screen = async () => shown().replace(/\x1b\[[0-9;]*m/g, '');
    return t;
  };

  it.each([
    ['empty', EMPTY],
    ['showing the hint of a fresh one', HINT],
    ['showing a suggestion', SUGGESTED],
  ])('presses nothing at a prompt %s: ctrl+s there would bring back what was put aside before', async (_, styled) => {
    const t = prompt(() => styled);
    expect(await claude(t).clearPrompt('s1')).toBe(true);
    expect(t.did).toEqual([]);
  });

  it.each([
    ['a line', TYPED],
    ['lines', TYPED_LINES],
  ])('puts %s typed at the prompt aside, and says so once the prompt is empty', async (_, typed) => {
    let shown = typed;
    const t = prompt(() => shown);
    t.sendRaw = async (name, keys) => {
      t.did.push(`keys ${name} ${JSON.stringify(keys)}`);
      if (keys === STASH) setTimeout(() => (shown = EMPTY), 30);
    };
    expect(await claude(t).clearPrompt('s1')).toBe(true);
    expect(t.did).toEqual(['leave s1', `keys s1 ${JSON.stringify(STASH)}`]);
    expect(shown, 'precondition: the prompt emptied after the key').toBe(EMPTY);
  });

  it('says so when what is typed does not go aside, pressing once', async () => {
    const t = prompt(() => TYPED);
    expect(await claude(t).clearPrompt('s1')).toBe(false);
    expect(t.did.filter((d) => d.startsWith('keys'))).toEqual([`keys s1 ${JSON.stringify(STASH)}`]);
  });
});
