import type { KeyValue, Visibility } from '../base/platform';

// When this device last looked at each session, to mark what changed since as unread. Kept per device;
// without storage nothing reads as unread.
const KEY = 'workoffdesk.seen';

// Marks a session seen while its page is in front: as the page comes in front or leaves it, and as something
// happens in it meanwhile. Returns what to call when something may have happened.
export function seenWhileInFront(seen: { markSeen(id: string): void }, id: string, page: Visibility, lastActivity: () => number | undefined) {
  let seenUpTo: number | undefined | null = null;
  const look = () => {
    seenUpTo = lastActivity();
    seen.markSeen(id);
  };
  page.onChange(look);
  return () => void (page.visible() && lastActivity() !== seenUpTo && look());
}

export function createSeen(storage: KeyValue) {
  const all = (): Record<string, number> => {
    try {
      return JSON.parse(storage.getItem(KEY) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  };
  const keep = (seen: Record<string, number>) => {
    try {
      storage.setItem(KEY, JSON.stringify(seen));
    } catch {
      // Nothing is kept; nothing reads as unread.
    }
  };
  return {
    markSeen(id: string): void {
      keep({ ...all(), [id]: Date.now() });
    },

    // Sessions never looked at here count as seen when first listed, so a new device does not start with
    // all of them unread.
    unreadOf(sessions: { id: string; lastActivity: number }[]): Set<string> {
      const seen = all();
      const unread = new Set<string>();
      let added = false;
      for (const s of sessions) {
        if (seen[s.id] === undefined) {
          seen[s.id] = s.lastActivity;
          added = true;
        } else if (s.lastActivity > seen[s.id]) unread.add(s.id);
      }
      if (added) keep(seen);
      return unread;
    },
  };
}
