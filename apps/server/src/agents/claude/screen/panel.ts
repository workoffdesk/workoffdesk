// A dialog a slash command opened over Claude Code's prompt (/usage, /config, /model, …), read off the
// screen. While one is up the prompt is gone, so typing goes into the dialog instead of to Claude.
// Its top edge is a row of ▔ (other text may share that row) or a plain rule; taller than the screen, that
// edge has scrolled into `above`, the scrollback just above the screen. Its key hint is the last block.
import { parseChoices } from './choices.js';

// title: Claude Code's heading for it, or a name of HEADINGS'; '' when it is not known what the dialog is. usage: the plan's percentages used, on /usage,
// null for a line the screen does not reach.
// effort: on /effort, the levels its slider has, left to right, and the one it is at.
// btw: on a /btw answer, the question it answers; the body is the answer, as much of it as is on the screen.
export type Panel = {
  title: string;
  body: string;
  hint: string;
  usage?: { session: number | null; week: number | null };
  effort?: { levels: string[]; at: number };
  btw?: { question: string };
};

const RULE = /^─{10,}$/;
// The prompt: a rule, maybe with a label on it, over the line being typed (❯, or ! in shell mode).
const PROMPT_TOP = /^─{10,}/;
const PROMPT_LINE = /^[❯!]/;
const EDGE = '▔';
// The settings dialog /config, /usage and /status open, whichever tab it is on.
const SETTINGS_TABS = /^Settings\s{2,}Status\s{2,}Config\b/;
const TABS_WRAPPED = /^\s*(Status|Config|Usage|Stats)(\s{2,}(Status|Config|Usage|Stats))*\s*$/;
const SEARCH_BOX = /^[╭│╰]/;
const HINT = /\bEsc to \w+|\bEnter to \w+/;
const TITLE_MAX = 40;
// The dialogs known by name. The settings dialog says which tab is up only by what it holds.
const HEADINGS: Record<string, string> = { 'Select model': 'Model', Effort: 'Effort' };
const USAGE_TAB = /^\s*Total cost:/m;
const CONFIG_TAB = /to search\b|Esc to clear/;

export function parsePanel(screen: string, above = ''): Panel | null {
  let shown = screen.split('\n').map((l) => l.trimEnd());
  // A dialog opened while Claude works stands above the prompt rather than in its place: what is above
  // the prompt is a dialog only when its key hint is the last thing there.
  const prompt = shown.findIndex((l, i) => i > 0 && PROMPT_TOP.test(shown[i - 1].trim()) && PROMPT_LINE.test(l));
  if (prompt > 0) {
    shown = shown.slice(0, prompt - 1);
    while (shown.length && !shown[shown.length - 1]) shown.pop();
    if (!HINT.test(shown.slice(shown.lastIndexOf('') + 1).join(' '))) return null;
  }
  const btw = btwOf(shown);
  if (btw) return btw;
  // A question Claude asks is for the choices; a dialog with options in it, whose edge is ▔, is not.
  if (!shown.some((l) => l.endsWith(EDGE)) && parseChoices(screen)) return null;

  const lines = above ? [...above.split('\n').map((l) => l.trimEnd()), ...shown] : shown;
  let top = -1;
  for (let i = lines.length - 1; i >= 0 && top < 0; i--) if (lines[i].endsWith(EDGE) || RULE.test(lines[i].trim())) top = i;
  if (top < 0) return null;
  let rest = lines.slice(top + 1);
  const indent = Math.min(...rest.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  rest = rest.map((l) => l.slice(indent)).filter((l) => !SEARCH_BOX.test(l));

  // The key hint: the last block of lines, wrapped across them.
  while (rest.length && !rest[rest.length - 1]) rest.pop();
  let hint = '';
  const blank = rest.lastIndexOf('');
  const last = rest.slice(blank + 1).join(' ');
  if (HINT.test(last)) {
    hint = last.replace(/\s+/g, ' ').trim();
    rest = rest.slice(0, Math.max(blank, 0));
  }

  const first = rest.findIndex((l) => l.trim());
  if (first < 0) return null;
  const heading = rest[first].trim();
  let from = first + 1;
  // The settings tabs wrapped onto a second line on a narrow screen.
  if (SETTINGS_TABS.test(heading) && TABS_WRAPPED.test(rest[from] ?? '')) from++;
  const body = rest
    .slice(from)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (SETTINGS_TABS.test(heading)) return usageOr({ title: CONFIG_TAB.test(hint) ? 'Settings' : '', body, hint });
  const title = heading ? (HEADINGS[heading] ?? heading.slice(0, TITLE_MAX)) : '';
  const effort = heading === 'Effort' ? effortOf(rest.slice(from)) : null;
  return effort ? { title, body, hint, effort } : usageOr({ title, body, hint });
}

// A /btw answer has no edge: the questions asked so far, each a line of `/btw …`, then the answer to the
// last, then its key hint, which offers to fork it.
const BTW_ASKED = /^\s*\/btw\s/;
const BTW_HINT = /\bto fork\b.*\bEsc to close\b/;
function btwOf(shown: string[]): Panel | null {
  const lines = [...shown];
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const gap = lines.lastIndexOf('');
  const hint = lines
    .slice(gap + 1)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (gap < 0 || !BTW_HINT.test(hint)) return null;
  const asked = lines.slice(0, gap).findLastIndex((l) => BTW_ASKED.test(l));
  if (asked < 0) return null;
  // The question runs on until the blank line under it, when it is too long for one.
  const below = lines.indexOf('', asked);
  const question = lines
    .slice(asked, below)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\/btw\s+/, '');
  const answer = lines.slice(below + 1, gap);
  const indent = Math.min(...answer.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  const body = answer
    .map((l) => l.slice(Number.isFinite(indent) ? indent : 0))
    .join('\n')
    .trim();
  return { title: 'Btw', body, hint, btw: { question } };
}

// The slider's marker (▲) on one line, the levels named under it; the level is the one whose name is
// centred nearest the marker.
const MARKER = '▲';
const LEVELS_END = /\s{3,}Tab to toggle.*$/;
function effortOf(lines: string[]): Panel['effort'] | null {
  const marked = lines.findIndex((l) => l.includes(MARKER));
  const named = lines[marked + 1];
  if (marked < 0 || !named) return null;
  const mark = lines[marked].indexOf(MARKER);
  const words = [...named.replace(LEVELS_END, '').matchAll(/\S+/g)];
  if (words.length < 2) return null;
  const off = (w: RegExpExecArray) => Math.abs(w.index + w[0].length / 2 - mark);
  const at = words.reduce((best, w, i) => (off(w) < off(words[best]) ? i : best), 0);
  return { levels: words.map((w) => w[0]), at };
}

function usageOr(p: Panel): Panel {
  const { body, hint } = p;
  return USAGE_TAB.test(body) ? { title: 'Usage', body, hint, usage: { session: used(body, 'Current session'), week: used(body, 'Current week') } } : p;
}

// The first percentage below a line of the plan. The session's line comes above the week's, so when its
// own percentage is off the screen, so is everything after it.
function used(body: string, line: string): number | null {
  const at = body.indexOf(line);
  const m = at < 0 ? null : /(\d+)% used/.exec(body.slice(at));
  return m ? Number(m[1]) : null;
}
