import { t } from '@workoffdesk/i18n';
import type { TermSession } from '../base/api';
import type { GroupingChoice } from '../settings/choices';
import { dirName, shortPath } from '../model/format';

// Whether a session fits what was typed in the search: its title or folder holds it, in any case.
export const matches = (s: TermSession, query: string) => {
  const needle = query.trim().toLowerCase();
  return !needle || [s.title, s.cwd, shortPath(s.cwd)].some((f) => f.toLowerCase().includes(needle));
};

// cwd: the folder the group is of, a git repository's main folder or a folder outside git; null for a group
// whose heading names no folder (the ended ones, or all of them when the list is not grouped).
export type SessionGroup = { cwd: string | null; title: string | null; sessions: TermSession[] };
export type ListView = { sorted: TermSession[] | null; shown: TermSession[]; groups: SessionGroup[] };

// Nothing runs in it: its agent quit, in the terminal left behind or gone from tmux with it (a past one).
const ended = (s: TermSession) => s.status === 'ended';
// The project a session is in: its git repository, worktrees and all, or its folder outside git (or from a Mac
// that does not say).
const projectOf = (s: TermSession) => s.project ?? s.cwd;

// The session list as both apps show it: the newest first, those that fit the search; those running by project,
// the one worked in last first, or as one when not grouped; then those that have ended in one group of their
// own. One project needs no heading. sorted is null while the list is loading.
export function listView(sessions: TermSession[] | null, query: string, grouping: GroupingChoice): ListView {
  const sorted = sessions && [...sessions].sort((a, b) => b.lastActivity - a.lastActivity);
  const shown = sorted?.filter((s) => matches(s, query)) ?? [];
  const running = shown.filter((s) => !ended(s));
  const groups: SessionGroup[] = [];
  if (grouping === 'none') {
    if (running.length) groups.push({ cwd: null, title: null, sessions: running });
  } else {
    for (const s of running) {
      const key = projectOf(s);
      const g = groups.find((x) => x.cwd === key);
      if (g) g.sessions.push(s);
      else groups.push({ cwd: key, title: dirName(key), sessions: [s] });
    }
    if (groups.length === 1) groups[0].title = null;
  }
  const over = shown.filter(ended);
  if (over.length) groups.push({ cwd: null, title: t.endedSessions, sessions: over });
  return { sorted, shown, groups };
}

// Where a row is, beside its title, said once: under its project's heading, the folder of it it is in (a
// worktree's or a folder's name) unless that is the project's own; with no heading, or under Ended, its project.
// Nothing when the title already is that name.
export function folderBeside(s: TermSession, group: SessionGroup): string | null {
  const headed = group.cwd !== null && group.title !== null;
  if (headed && s.cwd === group.cwd) return null;
  const place = dirName(headed ? s.cwd : projectOf(s));
  return place === s.title ? null : place;
}
