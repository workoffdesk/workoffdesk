import { t } from '@workoffdesk/i18n';

// A command Claude Code takes after a `/`, as the session's commands route lists it.
export type SlashCommand = { name: string; description: string; source: 'builtin' | 'project' | 'user' | 'plugin' };

// What a command is for, in the phone's language for Claude Code's own; the others say it as their files do.
export const describe = (c: SlashCommand) => (c.source === 'builtin' && t.builtinCommands[c.name]) || c.description;

// What has been typed of a command's name while the text is a `/` and the start of one name; null otherwise.
// A second `/` makes it a path, and a space or a new line means the name is done.
export function slashQuery(text: string): string | null {
  const m = /^\/([^\s/]*)$/.exec(text);
  return m ? m[1] : null;
}

// The commands that fit what was typed: names starting with it, then a part after a colon starting
// with it, then names holding it anywhere; each group in the order given.
export function matchCommands(all: SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase();
  const rank = (name: string) => {
    const n = name.toLowerCase();
    if (n.startsWith(q)) return 0;
    if (n.split(':').slice(1).some((part) => part.startsWith(q))) return 1;
    return n.includes(q) ? 2 : -1;
  };
  const ranked = all.map((c) => ({ c, r: rank(c.name) })).filter((x) => x.r >= 0);
  return [0, 1, 2].flatMap((r) => ranked.filter((x) => x.r === r).map((x) => x.c));
}

// The `@` being typed right before the caret and what follows it so far; null when the caret is not in one.
// An `@` counts at the start or after a space, so an address like a@b does not.
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}

const MENTIONS_SHOWN = 30;

// The files that fit what was typed after `@`: a name starting with it, then a name holding it, then a path
// holding it; shorter paths first in each.
export function matchFiles(all: string[], query: string): string[] {
  const q = query.toLowerCase();
  const rank = (path: string) => {
    const p = path.toLowerCase();
    const name = p.slice(p.lastIndexOf('/') + 1);
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    return p.includes(q) ? 2 : -1;
  };
  const ranked = all.map((path) => ({ path, r: rank(path) })).filter((x) => x.r >= 0);
  ranked.sort((a, b) => a.r - b.r || a.path.length - b.path.length);
  return ranked.slice(0, MENTIONS_SHOWN).map((x) => x.path);
}

// The text with the `@` being typed made a whole path, and where the caret goes after it: the rest of the
// word typed there is replaced, and one space follows.
export function withMention(text: string, caret: number, mention: { start: number }, path: string): { text: string; caret: number } {
  const after = text.slice(caret).replace(/^\S*/, '').replace(/^ /, '');
  const before = `${text.slice(0, mention.start)}@${path} `;
  return { text: before + after, caret: before.length };
}
