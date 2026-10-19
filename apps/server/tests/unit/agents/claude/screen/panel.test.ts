import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePanel } from '../../../../../src/agents/claude/screen/panel.js';

// Screens captured from Claude Code with `tmux capture-pane -p`.
const screen = (name: string) => readFileSync(new URL(`../../../../fixtures/screens/${name}.txt`, import.meta.url), 'utf8');

describe('parsePanel', () => {
  it('reads the settings dialog /usage opens, numbers and all', () => {
    const p = parsePanel(screen('settings-usage'))!;
    // /usage and /config share the settings dialog; which tab is up shows in what it holds.
    expect(p.title).toBe('Usage');
    // What is left of the plan, as far as the screen shows it: this week's line runs off the bottom.
    expect(p.usage).toEqual({ session: 9, week: null });
    expect(p.body).toMatch(/^Session\n\nTotal cost: {12}\$0\.0000\n/);
    expect(p.body).toContain('Current session · Resets 2am (Europe/Rome)');
    expect(p.body).toContain('9% used');
    // The tabs and the notice the panel's top edge runs through are not what it shows.
    expect(p.body).not.toMatch(/Settings {2}Status|tmux detected/);
    expect(p.hint).toBe('');
  });

  it('reads the settings dialog /config opens, with its key hint joined back from where it wrapped', () => {
    const p = parsePanel(screen('settings-config-search'))!;
    expect(p.title).toBe('Settings');
    expect(p.usage).toBeUndefined();
    expect(p.hint).toBe('Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear');
    expect(p.body).toMatch(/^❯ Auto-compact\n {4}true\n {2}Continue automatically/);
    expect(p.body).toMatch(/↓ 37 more$/);
    expect(p.body).not.toMatch(/Search settings|Esc to|╭|╰/);
    expect(parsePanel(screen('settings-config-list'))).toMatchObject({ title: 'Settings', hint: 'Enter/Space to change · / to search · Esc to close' });
  });

  it('names the settings tabs it does not know by nothing rather than by a wrong name', () => {
    const tabs = screen('settings-usage').replace(/\n {3}Session\n[\s\S]*$/, '\n   Version: 2.1.288\n   Login method: Claude Team\n');
    // Precondition: still the settings dialog, without the usage in it.
    expect(tabs).toMatch(/Settings {2}Status/);
    expect(tabs).not.toContain('Total cost');
    expect(parsePanel(tabs)!.title).toBe('');
  });

  it('knows the usage tab when a line of it runs past the edge of a narrow screen', () => {
    const narrow = screen('settings-usage').replace(/Resets Oct 8 at ↓\n?$/, 'Resets Oct 8 at\n9am\n   12% used\n');
    expect(parsePanel(narrow)).toMatchObject({ title: 'Usage', usage: { session: 9, week: 12 } });
  });

  it('reads both lines of the plan when both are on screen', () => {
    const week = screen('settings-usage').replace(/Resets Oct 8 at ↓\n?$/, 'Resets Oct 8 at 9am\n   ███████▌\n\n   41% used\n');
    expect(parsePanel(week)!.usage).toEqual({ session: 9, week: 41 });
  });

  it('names a dialog by its heading', () => {
    expect(parsePanel(screen('model-picker'))!.title).toBe('Model');
    const other = screen('model-picker').replace('Select model', 'Select output style');
    expect(parsePanel(other)!.title).toBe('Select output style');
    const p = parsePanel(screen('model-picker'))!;
    expect(p.body).toMatch(/^Switch between Claude models\./);
    expect(p.body).toContain('Sonnet 5.5');
    expect(p.body).not.toContain('Select model');
  });

  it.each(['idle-input', 'idle-after-answer', 'idle-after-panels', 'idle-after-usage'])(
    'sees no panel while the prompt is out: %s',
    (name) => expect(parsePanel(screen(name))).toBeNull(),
  );

  it.each(['trust-folder', 'ask-user-question'])('leaves a question Claude asks to the choices: %s', (name) =>
    expect(parsePanel(screen(name))).toBeNull(),
  );

  it('sees no panel once one closed and the prompt came back below it', () => {
    const prompt = `\n${'─'.repeat(49)}\n❯ \n${'─'.repeat(49)}\n  Alice  Opus 5.5\n`;
    // Precondition: without the prompt below it, this is a panel.
    expect(parsePanel(screen('settings-usage'))).not.toBeNull();
    expect(parsePanel(screen('settings-usage') + prompt)).toBeNull();
  });

  it('sees no panel on a screen without the edge of a dialog, as a shell has', () => {
    expect(parsePanel('alice@mac ~ % ls\nREADME.md  src\nalice@mac ~ % \n', 'alice@mac ~ % cd src\n')).toBeNull();
    expect(parsePanel('')).toBeNull();
  });

  // From a phone 37 columns wide: this /usage has a plain rule for its top edge, not a row of ▔.
  it('reads /usage on a narrow screen, whose top edge is a plain rule and whose tabs wrap', () => {
    const p = parsePanel(screen('usage-narrow-top'))!;
    expect(p).toMatchObject({ title: 'Usage', usage: { session: null, week: null } });
    expect(p.body).toMatch(/^Session\n\nTotal cost: {12}\$24\.43/);
    expect(p.body).not.toMatch(/Settings|Usage {3}Stats/);
  });

  it('reads a dialog taller than the screen from its top edge, scrolled off above the screen', () => {
    const shown = screen('usage-narrow-overflow');
    // Precondition: nothing of the dialog's top is left on the screen.
    expect(shown).not.toMatch(/▔|^─|Settings|Total cost/m);
    const above = `⏺ Earlier reply\n\n❯ /usage\n\n${screen('usage-narrow-top').split('\n').slice(0, 7).join('\n')}`;
    const p = parsePanel(shown, above)!;
    expect(p).toMatchObject({ title: 'Usage', usage: { session: 9, week: null } });
    expect(p.body).toMatch(/^Session\n\nTotal cost: {12}\$24\.43/);
    expect(p.body).toMatch(/24m 37s ago/);
    // A dialog that closed long ago, its edge still in the scrollback, is not one now.
    expect(parsePanel(screen('idle-input'), above)).toBeNull();
  });

  it.each([
    ['a label on its top rule', `${'─'.repeat(30)} plan ──\n❯ \n${'─'.repeat(37)}\n`],
    ['shell mode', `${'─'.repeat(37)}\n! ls\n${'─'.repeat(37)}\n  ! for bash mode\n`],
    ['a draft of several lines', `${'─'.repeat(37)}\n❯ first line\n  second line\n${'─'.repeat(37)}\n`],
  ])('sees the prompt with %s', (_, prompt) => {
    expect(parsePanel(`⏺ Done.\n\n${prompt}  Alice  Opus 5.5\n`)).toBeNull();
  });

  // Captured from Claude Code v2.1.289, 60 columns by 40 (100 for effort-wide). What a test changes in one is said there.
  // Claude Code 2.1.303's /tasks: its rows are drawn as a question's options are, and it is not one.
  describe('with the /tasks dialog', () => {
    it('reads its list: each task, what it is at, and the one selected', () => {
      expect(parsePanel(screen('tasks-list'))).toMatchObject({
        title: 'Tasks',
        hint: '↑/↓ to select · Enter to view · x to stop · Esc to close',
        tasks: { rows: [{ label: 'sleep 901', status: 'running' }, { label: 'pnpm dev', status: 'running' }], at: 0 },
      });
      const second = screen('tasks-list').replace('  ❯ ⏺ sleep 901', '    ⏺ sleep 901').replace('    ⏺ pnpm dev', '  ❯ ⏺ pnpm dev');
      expect(parsePanel(second)?.tasks?.at).toBe(1);
    });

    it('reads its list with nothing in it', () => {
      expect(parsePanel(screen('tasks-none'))).toMatchObject({ title: 'Tasks', tasks: { rows: [], at: -1 } });
    });

    it('reads a task opened from it: what it is, and its output', () => {
      expect(parsePanel(screen('tasks-detail'))).toMatchObject({
        title: 'Tasks',
        hint: '← to go back · Esc/Enter/Space to close · x to stop',
        task: { fields: [{ name: 'Status', value: 'running' }, { name: 'Runtime', value: '46s' }, { name: 'Command', value: 'sleep 901' }], output: 'No output available' },
      });
    });

    it('reads a command too long for its line whole, and output of many lines', () => {
      const long = screen('tasks-detail')
        .replace('  Command:  sleep 901', '  Command:  cd /tmp/project && pnpm install &&\n            pnpm dev')
        .replace('  No output available', '  ready in 300 ms\n  listening on :3000');
      expect(parsePanel(long)?.task).toEqual({
        fields: [{ name: 'Status', value: 'running' }, { name: 'Runtime', value: '46s' }, { name: 'Command', value: 'cd /tmp/project && pnpm install && pnpm dev' }],
        output: 'ready in 300 ms\nlistening on :3000',
      });
    });
  });

  describe('with a /btw answer', () => {
    it('reads the answer to the question asked, with the key hint under it', () => {
      expect(parsePanel(screen('btw-answer'))).toEqual({
        title: 'Btw',
        body: '2+2 = 4。',
        hint: '↑/↓ to scroll · c to copy · f to fork · Esc to close',
        btw: { question: 'what is 2+2' },
      });
    });

    it('reads the answer to the last of the questions asked so far, as much of it as is on the screen, its hint wrapped onto one line', () => {
      const p = parsePanel(screen('btw-history'))!;
      expect(p.btw).toEqual({ question: 'list 40 animals, one per line, numbered' });
      expect(p.body.split('\n')).toEqual(expect.arrayContaining(['1. 狗 (Dog)', '28. 老鼠 (Mouse)']));
      expect(p.body.split('\n')).toHaveLength(28);
      expect(p.hint).toBe('⇧←/→ to browse · c to copy · f to fork · x to clear history · Esc to close');
    });

    it('reads the question in full when it runs on to a second line', () => {
      const wrapped = screen('btw-history').replace('  /btw list 40 animals, one per line, numbered\n', '  /btw list 40 animals, one per\n  line, numbered\n');
      expect(parsePanel(wrapped)!.btw).toEqual({ question: 'list 40 animals, one per line, numbered' });
    });

    it('keeps what is indented further in the answer as far in as it was', () => {
      const nested = screen('btw-answer').replace('    2+2 = 4。\n', '    2+2 = 4。\n      - in any base above 4\n');
      expect(parsePanel(nested)!.body).toBe('2+2 = 4。\n  - in any base above 4');
    });

    it('reads as many paragraphs as the answer has, none of them indented', () => {
      const paragraphs = screen('btw-answer').replace('    2+2 = 4。\n', '    2+2 = 4。\n\n    In any base above 4.\n');
      expect(parsePanel(paragraphs)!.body).toBe('2+2 = 4。\n\nIn any base above 4.');
    });

    it.each<[string, (s: string) => string]>([
      ['its hint does not offer to fork it', (s) => s.replace(' · f to fork', '')],
      ['its hint does not close it', (s) => s.replace(' · Esc to close', '')],
      ['no question is above it', (s) => s.replace('  /btw what is 2+2\n', '  what is 2+2\n')],
    ])('sees no answer when %s', (_, change) => {
      expect(parsePanel(change(screen('btw-answer')))?.btw).toBeUndefined();
    });
  });

  describe('with the /effort slider', () => {
    const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

    it.each(['effort-wide', 'effort-narrow'])('reads the level its marker is over, its levels left to right (%s)', (name) => {
      expect(parsePanel(screen(name))).toMatchObject({
        title: 'Effort',
        hint: '←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel',
        effort: { levels: LEVELS, at: 1 },
      });
    });

    // The marker moved along the line of the wide capture: under each name, then past either end.
    it.each<[number, number]>([
      [19, 0],
      [0, 0],
      [29, 1],
      [34, 1],
      [39, 2],
      [50, 3],
      [61, 4],
      [70, 4],
    ])('reads the level whose name is centred nearest a marker in column %i', (column, at) => {
      const s = screen('effort-wide').replace(/^.*▲.*$/m, (line) => {
        const moved = [...line.replace('▲', '─')];
        moved[column] = '▲';
        return moved.join('');
      });
      expect(s.split('\n').find((l) => l.includes('▲'))!.indexOf('▲')).toBe(column);
      expect(parsePanel(s)!.effort).toEqual({ levels: LEVELS, at });
    });

    it.each<[string, (s: string) => string]>([
      ['no marker', (s) => s.replace('▲', '─')],
      ['no names under the marker', (s) => s.replace(/\n +low +medium.*\n/, '\n\n')],
      ['one name under the marker', (s) => s.replace(/low +medium +high +xhigh +max/, 'medium')],
      ['another heading than Effort', (s) => s.replace('  Effort\n', '  Model\n')],
    ])('reads a dialog without a slider when it has %s', (_, change) => {
      const p = parsePanel(change(screen('effort-wide')))!;
      expect(p.hint).toMatch(/Esc to cancel$/);
      expect(p.effort).toBeUndefined();
    });
  });
});
