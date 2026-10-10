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
const tmux = (o: { screen?: string; styled?: string | Error; joined?: string; cols?: number | Error } = {}) => {
  const did: string[] = [];
  const t = {
    did,
    shown: o.screen ?? QUESTION,
    screen: async () => t.shown,
    screenAndAbove: async (_: string, lines: number) => (did.push(`above ${lines}`), { screen: t.shown, above: '' }),
    screenStyled: async () => {
      if (o.styled instanceof Error) throw o.styled;
      return o.styled ?? '';
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
