import { afterAll, describe, expect, it, vi } from 'vitest';
import { askOptions, EFFORTS, effortName, effortsOf, modelItems, noteText, panelName, pickerHead, type Ask, type ModelChoice } from '../../src/model/chat';

afterAll(() => {
  vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });
});

describe('noteText', () => {
  it.each<[string, Parameters<typeof noteText>[0], string]>([
    ['its own words, when the server sent words', { text: 'Session resumed' }, 'Session resumed'],
    ['nothing, when the words are none', { text: '' }, ''],
    ['that the conversation was compacted', { event: { e: 'compacted' } }, 'Earlier conversation compacted'],
    ['that Claude was interrupted', { event: { e: 'interrupted' } }, 'Interrupted'],
    ['that something went wrong', { event: { e: 'failed' } }, 'Something went wrong'],
    ["that the account's usage limit was reached", { event: { e: 'failed', limit: true } }, 'Usage limit reached'],
    ['how a background task ended', { event: { e: 'task', status: 'completed', what: 'npm test' } }, 'Background task done: npm test'],
    ['who a message came from', { event: { e: 'peer', from: 'api-server' } }, 'Message from api-server'],
  ])('returns %s', (_, note, expected) => {
    expect(noteText(note)).toBe(expected);
  });
});

describe('panelName', () => {
  it.each([
    ['by the name it is known by', 'Btw', 'the “Side question” panel'],
    ['by its title as words, spaced out as the dialog draws it', 'Status   Config', 'the “Status Config” panel'],
    ['by nothing that may be wrong, when it has no title', '', 'a panel'],
  ])('names a panel %s', (_, title, expected) => {
    expect(panelName({ title, body: '', hint: '' })).toBe(expected);
  });
});

describe('effortName', () => {
  it("keeps an effort level's own name where the language has none for it", () => {
    expect(effortName('xhigh')).toBe('xhigh');
  });

  it("names an effort level in the reader's language where it has one", async () => {
    vi.resetModules();
    vi.stubGlobal('navigator', { language: 'zh-CN', languages: ['zh-CN'] });
    const { effortName: inChinese } = await import('../../src/model/chat');
    expect(['low', 'xhigh', 'turbo'].map(inChinese)).toEqual(['低', '超高', 'turbo']);
  });
});

// Claude Code's list for the session, as server/agents/claude/offers/models.ts gives it.
const LIST: ModelChoice[] = [
  { value: 'default', name: 'Opus 5.5', about: 'Most capable', efforts: ['low', 'medium', 'high'] },
  { value: 'sonnet', name: 'Sonnet 5.5', about: '', efforts: [] },
];

describe('modelItems', () => {
  it("lists Claude Code's models, the one in use marked, each picked by its value", () => {
    expect(modelItems(LIST, 'Opus 5.5')).toEqual([
      { label: 'Opus 5.5', sub: 'Most capable', current: true, command: '/model default' },
      { label: 'Sonnet 5.5', sub: undefined, current: false, command: '/model sonnet' },
    ]);
  });

  it.each([null, undefined, []])('offers the latest of each family and the picker for the rest without a list (%j)', (models) => {
    expect(modelItems(models, 'Opus 5.5')).toEqual([
      { label: 'Opus', current: false, command: '/model opus' },
      { label: 'Fable', current: false, command: '/model fable' },
      { label: 'Sonnet', current: false, command: '/model sonnet' },
      { label: 'Haiku', current: false, command: '/model haiku' },
      { label: 'Other models…', current: false, command: '/model' },
    ]);
  });
});

describe('effortsOf', () => {
  it.each<[string, ModelChoice[] | null, string | undefined, string[]]>([
    ['the levels the model in use takes', LIST, 'Opus 5.5', ['low', 'medium', 'high']],
    ['every level, for a model that lists none', LIST, 'Sonnet 5.5', EFFORTS],
    ['every level, for a model not in the list', LIST, 'Haiku 4.5', EFFORTS],
    ['every level, without a list', null, 'Opus 5.5', EFFORTS],
  ])('offers %s', (_, models, model, expected) => {
    expect(effortsOf(models, model)).toEqual(expected);
  });
});

describe('pickerHead', () => {
  it('names /model and says what it is for', () => {
    // parseChoices' context for tests/fixtures/screens/model-picker.txt in apps/server.
    const context = 'Select model\nSwitch between Claude models. Your pick becomes the default for\nnew sessions. For other/previous model names, specify with\n--model.';
    expect(pickerHead(context)).toEqual({ title: 'Model', about: 'Your pick becomes the default for new sessions' });
  });

  it('names the settings dialog Settings without reading its tabs or search box', () => {
    const context = 'Settings  Status   Config   Usage   Stats\n\n╭──────────────╮\n│ ⌕ Search settings… │\n╰──────────────╯';
    expect(pickerHead(context)).toEqual({ title: 'Settings', about: '' });
  });

  it('takes the first line as the title and joins the rest for an unknown picker', () => {
    expect(pickerHead('  Rewind\n\n  Restore the code and/or conversation\n  to the point before…  ')).toEqual({ title: 'Rewind', about: 'Restore the code and/or conversation to the point before…' });
  });

  it('leaves out the search box of an unknown picker', () => {
    expect(pickerHead('Resume a session\n╭─────────╮\n│ ⌕ Search… │\n╰─────────╯\nPick one to go on with')).toEqual({ title: 'Resume a session', about: 'Pick one to go on with' });
  });

  it('returns nothing for an empty context', () => {
    expect(pickerHead('')).toEqual({ title: '', about: '' });
  });
});

describe('askOptions', () => {
  const ask = (always: Ask['always']): Ask => ({ id: 'p1', kind: 'permission', tool: 'Bash', title: 'Run npm test', detail: 'npm test', always });
  const NO = { label: 'No', detail: 'It stops and waits for you to say what to do', answer: { allow: false } };

  it('offers yes and no when nothing can be allowed from now on', () => {
    expect(askOptions(ask(null))).toEqual([{ label: 'Yes', answer: { allow: true } }, NO]);
  });

  it('spells out all that a yes from now on allows, one rule per line of code', () => {
    expect(askOptions(ask({ rules: ['Bash(npm test:*)', 'Bash(npm run lint:*)'], dirs: ['/Users/someone/work/app', '/work/lib'], mode: 'acceptEdits' }))[1]).toEqual({
      label: 'Yes, and from now on accept all edits and allow these and allow access to ~/work/app, /work/lib',
      code: 'Bash(npm test:*)\nBash(npm run lint:*)',
      answer: { allow: true, always: true },
    });
  });

  it.each<[string, NonNullable<Ask['always']>, string]>([
    ['only a mode', { rules: [], dirs: [], mode: 'plan' }, 'Yes, and from now on switch to plan mode'],
    ['only folders', { rules: [], dirs: ['/work/lib'], mode: null }, 'Yes, and from now on allow access to /work/lib'],
  ])('shows no code when a yes from now on allows %s', (_, always, label) => {
    const [, from] = askOptions(ask(always));
    expect(from).toEqual({ label, answer: { allow: true, always: true } });
  });
});
