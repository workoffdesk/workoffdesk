import { t } from '@workoffdesk/i18n';
import { errorText, MACHINE, type Api } from '../base/api';

// How long typing a path pauses before the Mac is asked for the folders in it.
export const DIRS_WAIT_MS = 150;

// What is typed in the picker's box is a path when it starts at home or at the root; anything else searches the
// projects already known.
export const isPath = (q: string) => q === '~' || q.startsWith('~/') || q.startsWith('/');

const nameOf = (dir: string) => dir.slice(dir.lastIndexOf('/') + 1);

const inOrder = (text: string, letters: string) => {
  let at = 0;
  for (const ch of letters) {
    at = text.indexOf(ch, at) + 1;
    if (!at) return false;
  }
  return true;
};

// The known projects that match a search: those whose folder's name starts with it, then those whose name has
// it, then those whose path has its letters in order; each in the order they came, which is the latest first.
export function matchProjects(dirs: string[], q: string): string[] {
  const want = q.toLowerCase();
  const rank = (dir: string) => {
    const name = nameOf(dir).toLowerCase();
    if (name.startsWith(want)) return 0;
    if (name.includes(want)) return 1;
    return inOrder(dir.toLowerCase(), want) ? 2 : null;
  };
  return dirs
    .map((dir) => ({ dir, rank: rank(dir) }))
    .filter((x): x is { dir: string; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.dir);
}

// What the box says once a listed folder is gone into: what was typed up to its last '/', the folder's name, '/'.
export function into(typed: string, dir: string): string {
  const base = typed === '~' ? '~/' : typed.slice(0, typed.lastIndexOf('/') + 1);
  return `${base}${nameOf(dir)}/`;
}

// path: the box holds a path. rows: the folders to show, null until there are any to show; for a path, the last
// the Mac answered since the box became one, and only ever an answer for what was typed when it came.
export type ProjectSearchSnapshot = { text: string; path: boolean; rows: string[] | null; error: string | null };

export function createProjectSearch(api: Api) {
  const listeners = new Set<() => void>();
  let known: string[] | null = null;
  let typed = '';
  let found: { rows: string[]; error: string | null } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let held = false;

  const build = (): ProjectSearchSnapshot => {
    const path = isPath(typed);
    if (path) return { text: typed, path, rows: found?.rows ?? null, error: found?.error ?? null };
    return { text: typed, path, rows: known && matchProjects(known, typed), error: null };
  };
  let snapshot = build();
  const publish = () => {
    snapshot = build();
    for (const l of listeners) l();
  };

  const ask = (q: string) => {
    const show = (rows: string[], error: string | null) => {
      if (q !== typed || !held) return;
      found = { rows, error };
      publish();
    };
    api<string[]>(`/api/m/${MACHINE}/dirs?path=${encodeURIComponent(q)}`).then(
      (rows) => show(rows, null),
      (e) => show([], errorText(e, t.loadFailed)),
    );
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    // What the box holds now.
    type(text: string) {
      if (!held) return;
      typed = text.trim();
      clearTimeout(timer);
      if (isPath(typed)) timer = setTimeout(() => ask(typed), DIRS_WAIT_MS);
      else found = null;
      publish();
    },
    // The projects already known, once they come.
    setKnown(dirs: string[] | null) {
      known = dirs;
      publish();
    },
    // Held while the picker shows; once let go, nothing is asked or changed until it is held again.
    hold() {
      held = true;
      return () => {
        held = false;
        clearTimeout(timer);
      };
    },
  };
}

export type ProjectSearch = ReturnType<typeof createProjectSearch>;
