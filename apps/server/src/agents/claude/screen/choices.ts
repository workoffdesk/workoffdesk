// A choice Claude Code is asking for (a permission prompt, a question, a picker), read off the screen:
// the transcript has no record of it. Options are lines in one column, the current one marked ❯ and the
// others indented to match; descriptions that wrap continue further in. Claude Code moves through them
// with the arrow keys and takes one with Enter (number keys do nothing in some of them).
//
// A question that takes several answers draws a box before each option, ticked with Space, and a Submit
// (Next while more questions follow) under the options, which sends them with Enter. The arrows reach it
// as though it were one more option, so a cursor on it is `options.length`.

// typed: the option is a text field for an answer of one's own, as Claude's questions end with.
// ticked and submit are there only for a question that takes several answers.
export type Choices = {
  context: string;
  options: { label: string; detail: string; typed?: true; ticked?: boolean }[];
  cursor: number;
  submit?: string;
  // The key that takes an option when it is not Enter: /model takes one for this session only with s,
  // where Enter would also make it the default for every new session.
  take?: string;
  // The plan file Claude asks to go ahead with, named in the hint under its options, and what it says.
  planFile?: string;
  plan?: string;
  // A picker the person opened (/model, /rewind), not something Claude asks.
  opened?: true;
};

const CONTEXT_LINES = 15;
const RULE = /^\s*[─━▔═]{3,}\s*$/;
const CHECKBOX = /^\[([ ✔√]?)\]\s*/;
const SUBMIT = /^\s*(❯\s*)?(Submit|Next)$/;
const TYPED = /^Type something\b/i;
const THIS_SESSION_ONLY = /\bs to use this session only\b/;
// The pickers a slash command opens: /model's, and the settings dialog /config opens on its Config tab.
const OPENED_HEADINGS = /^(Select model|Settings\s{2,}Status\s{2,}Config\b.*)$/;
const PLAN_FILE = /~\/\.claude\/plans\/([\w.-]+\.md)\b/;
// /rewind lists the messages sent, each with what it changed on a line under it, apart by blank lines.
const REWIND_HEAD = /^\s*Restore the code and\/or conversation to the point before/;
const REWIND_HINT = /^\s*Enter to continue\b/;

export function parseChoices(screen: string): Choices | null {
  const lines = screen.split('\n').map((l) => l.trimEnd());
  const rewind = rewindChoices(lines);
  if (rewind !== undefined) return rewind;
  // Earlier prompts stay in the scrollback, marked ❯ too: only the last one on screen can be live. A dialog
  // opened while Claude works is drawn above its prompt, whose ❯ under the rule is not the dialog's.
  let row = -1;
  for (let i = lines.length - 1; i >= 0 && row < 0; i--) if (lines[i].includes('❯') && !isPromptLine(lines, i)) row = i;
  if (row < 0) return null;
  const onSubmit = SUBMIT.test(lines[row]);
  if (onSubmit) {
    // The options above are all unmarked, indented where the ❯ would go.
    let i = row - 1;
    while (i >= 0 && !/^\s* {2}\d+\. \S/.test(lines[i])) i--;
    if (i < 0) return null;
    row = i;
  }
  const cur = (onSubmit ? /^(\s*) {2}\d/ : /^(\s*)❯ \S/).exec(lines[row]);
  if (!cur) return null;
  const c = cur[1].length;

  // At the very edge, where earlier prompts and what follows them sit too, only numbered lines are options.
  const isOption = (l: string) =>
    l.slice(0, c).trim() === '' &&
    ' ❯↓↑'.includes(l[c] ?? '') &&
    l[c + 1] === ' ' &&
    /^[^\s…]/.test(l.slice(c + 2)) &&
    (c > 0 || /^\d+\. /.test(l.slice(c + 2)));
  const isMore = (l: string) => l.slice(0, c + 3).trim() === '' && /^[^\s…]/.test(l.trim()) && !SUBMIT.test(l);

  if (!isOption(lines[row])) return null;
  let start = row;
  while (start > 0 && (isOption(lines[start - 1]) || isMore(lines[start - 1]))) start--;
  while (!isOption(lines[start])) start++;
  let end = row;
  while (end + 1 < lines.length && (isOption(lines[end + 1]) || isMore(lines[end + 1]))) end++;

  const options: Choices['options'] = [];
  let cursor = 0;
  for (let i = start; i <= end; i++) {
    if (isOption(lines[i])) {
      if (i === row) cursor = options.length;
      const text = lines[i].slice(c + 2).replace(/^\d+\.\s+/, '');
      const box = CHECKBOX.exec(text);
      const [label, ...detail] = text.slice(box?.[0].length ?? 0).split(/\s{2,}/);
      options.push({
        label,
        detail: detail.join(' '),
        ...(box && { ticked: box[1].trim() !== '' }),
        ...(TYPED.test(label) && { typed: true as const }),
      });
    } else {
      const last = options[options.length - 1];
      last.detail = [last.detail, lines[i].trim()].filter(Boolean).join(' ');
    }
  }
  if (options.length < 2) return null;
  const below = lines.slice(end + 1, end + 6);
  const take = below.some((l) => THIS_SESSION_ONLY.test(l)) ? { take: 's' } : {};
  const planFile = below.map((l) => PLAN_FILE.exec(l)?.[1]).find(Boolean);
  if (!options.some((o) => 'ticked' in o))
  {
    if (onSubmit) return null;
    const context = contextAbove(lines, start);
    const opened = OPENED_HEADINGS.test(context.split('\n')[0].trim()) ? { opened: true as const } : {};
    return { context, options, cursor, ...take, ...(planFile && { planFile }), ...opened };
  }
  // Ticks with no Submit in sight could not be sent.
  const submit = submitBelow(lines, end);
  if (!submit) return null;
  return { context: contextAbove(lines, start), options, cursor: onSubmit ? options.length : cursor, submit };
}

// The line being typed at Claude's prompt: ❯ at the edge, right under the prompt's rule.
function isPromptLine(lines: string[], i: number): boolean {
  return lines[i].startsWith('❯') && i > 0 && /^─{10,}/.test(lines[i - 1]);
}

// The messages /rewind offers to go back to before, one option each; undefined when /rewind is not up.
function rewindChoices(lines: string[]): Choices | null | undefined {
  let head = -1;
  for (let i = lines.length - 1; i >= 0 && head < 0; i--) if (REWIND_HEAD.test(lines[i])) head = i;
  if (head < 0) return undefined;
  let hint = head + 1;
  while (hint < lines.length && !REWIND_HINT.test(lines[hint])) hint++;
  if (hint === lines.length) return undefined;
  const blocks: string[][] = [[]];
  for (const l of lines.slice(head + 1, hint)) {
    if (l.trim()) blocks[blocks.length - 1].push(l);
    else if (blocks[blocks.length - 1].length) blocks.push([]);
  }
  const entries = blocks.filter((b) => b.length);
  const cursor = entries.findIndex((b) => b[0].includes('❯'));
  if (entries.length < 2 || cursor < 0) return null;
  return {
    opened: true,
    context: lines[head].trim(),
    options: entries.map(([first, ...rest]) => ({ label: first.replace(/^\s*[❯↑↓]?\s*/, ''), detail: rest.map((l) => l.trim()).join(' ') })),
    cursor,
  };
}

// The Submit (or Next) right under the options, a blank line or a rule between them at most.
function submitBelow(lines: string[], end: number): string | null {
  for (let i = end + 1; i <= end + 2 && i < lines.length; i++) {
    const m = SUBMIT.exec(lines[i]);
    if (m) return m[2];
  }
  return null;
}

// What the choice is about: the lines above it, back to a rule or a screenful's worth.
function contextAbove(lines: string[], start: number): string {
  const above: string[] = [];
  for (let i = start - 1; i >= 0 && above.length < CONTEXT_LINES && !RULE.test(lines[i]); i--) above.unshift(lines[i]);
  const indent = Math.min(...above.filter(Boolean).map((l) => l.length - l.trimStart().length));
  return above
    .map((l) => (QUESTION_TABS.test(l.trim()) ? questionsOf(l) : l.slice(indent)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Several questions asked at once have a row of tabs over them, `←  ☒ Color  ☐ Fruits  ✔ Submit  →`, a box
// ticked for each answered; said as `✓ Color · ○ Fruits`.
const QUESTION_TABS = /^←\s.*[☐☒].*→$/;
function questionsOf(line: string): string {
  return [...line.matchAll(/([☐☒])\s(.+?)(?=\s{2,}|\s*→$)/g)].map(([, box, name]) => `${box === '☒' ? '✓' : '○'} ${name}`).join(' · ');
}

const UP = '\x1b[A';
const DOWN = '\x1b[B';

// Moves to option `to` and takes it. An answer to be typed is only moved onto: Enter on it while empty
// declines the question, so the text and its Enter come after (ClaudeScreen.choose).
export function keysToChoose(c: Choices, to: number): string {
  const move = to > c.cursor ? DOWN.repeat(to - c.cursor) : UP.repeat(c.cursor - to);
  return c.options[to]?.typed ? move : `${move}${c.take ?? '\r'}`;
}

// Presses Space on each option whose tick differs from `ticked`, then goes on down to Submit and presses
// Enter. `ticked` must not hold an answer of one's own: Space in it would be typed.
export function keysToTick(c: Choices, ticked: number[]): string {
  let at = c.cursor;
  const moveTo = (to: number) => {
    const keys = to > at ? DOWN.repeat(to - at) : UP.repeat(at - to);
    at = to;
    return keys;
  };
  let keys = '';
  c.options.forEach((o, i) => {
    if (!!o.ticked !== ticked.includes(i)) keys += `${moveTo(i)} `;
  });
  return `${keys}${moveTo(c.options.length)}\r`;
}
