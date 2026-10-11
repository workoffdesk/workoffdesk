import { t } from '@workoffdesk/i18n';
import type { TermSession } from '../base/api';
import { dirName, ownName, shortPath } from '../model/format';

// Whether a session fits what was typed in the search: its title or folder holds it, in any case.
export const matches = (s: TermSession, query: string) => {
  const needle = query.trim().toLowerCase();
  return !needle || [s.title, s.cwd, shortPath(s.cwd)].some((f) => f.toLowerCase().includes(needle));
};

// cwd: the folder the group is of; null for the ended ones, whose heading names no folder.
export type SessionGroup = { cwd: string | null; title: string | null; sessions: TermSession[] };
export type ListView = { sorted: TermSession[] | null; shown: TermSession[]; groups: SessionGroup[] };

// Nothing runs in it: its agent quit, in the terminal left behind or gone from tmux with it (a past one).
const ended = (s: TermSession) => s.status === 'ended';

// The session list as both apps show it: the newest first, those that fit the search, those running by folder
// with the one worked in last first, then those that have ended in one group of their own. One running folder
// needs no heading. sorted is null while the list is loading.
export function listView(sessions: TermSession[] | null, query: string): ListView {
  const sorted = sessions && [...sessions].sort((a, b) => b.lastActivity - a.lastActivity);
  const shown = sorted?.filter((s) => matches(s, query)) ?? [];
  const groups: SessionGroup[] = [];
  for (const s of shown.filter((s) => !ended(s))) {
    const g = groups.find((x) => x.cwd === s.cwd);
    if (g) g.sessions.push(s);
    else groups.push({ cwd: s.cwd, title: dirName(s.cwd), sessions: [s] });
  }
  if (groups.length === 1) groups[0].title = null;
  const over = shown.filter(ended);
  if (over.length) groups.push({ cwd: null, title: t.endedSessions, sessions: over });
  return { sorted, shown, groups };
}

// The folder a row shows beside its title: a row says its folder once, so not under a heading naming it, nor
// when the title is the folder's name already.
export function folderBeside(s: TermSession, group: SessionGroup): string | null {
  return (group.cwd && group.title) || !ownName(s) ? null : dirName(s.cwd);
}
