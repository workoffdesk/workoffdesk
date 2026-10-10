import type { TermSession } from '../base/api';
import { dirName, ownName, shortPath } from '../model/format';

// Whether a session fits what was typed in the search: its title or folder holds it, in any case.
export const matches = (s: TermSession, query: string) => {
  const needle = query.trim().toLowerCase();
  return !needle || [s.title, s.cwd, shortPath(s.cwd)].some((f) => f.toLowerCase().includes(needle));
};

export type SessionGroup = { cwd: string; title: string | null; sessions: TermSession[] };
export type ListView = { sorted: TermSession[] | null; shown: TermSession[]; groups: SessionGroup[] };

// The session list as both apps show it: the newest first, those that fit the search, by folder with the one
// worked in last first. One folder needs no heading. sorted is null while the list is loading.
export function listView(sessions: TermSession[] | null, query: string): ListView {
  const sorted = sessions && [...sessions].sort((a, b) => b.lastActivity - a.lastActivity);
  const shown = sorted?.filter((s) => matches(s, query)) ?? [];
  const groups: SessionGroup[] = [];
  for (const s of shown) {
    const g = groups.find((x) => x.cwd === s.cwd);
    if (g) g.sessions.push(s);
    else groups.push({ cwd: s.cwd, title: dirName(s.cwd), sessions: [s] });
  }
  if (groups.length === 1) groups[0].title = null;
  return { sorted, shown, groups };
}

// The folder a row shows beside its title: a row says its folder once, so not under a heading naming it, nor
// when the title is the folder's name already.
export function folderBeside(s: TermSession, heading: string | null): string | null {
  return heading || !ownName(s) ? null : dirName(s.cwd);
}
