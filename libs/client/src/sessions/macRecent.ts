import type { Api, RecentConversation, TermSession } from '../base/api';
import { recentConversations } from './newSession';
import type { KeyValue, Visibility } from '../base/platform';

// The list of Claude and Codex conversations on the Mac, kept so a list opened again shows it before the Mac answers,
// and a request that fails leaves it standing.
export const MAC_KEY = 'workoffdesk.mac-sessions';
// Conversations people had on this Mac lately and not opened here: how far back, and how many.
export const MAC_RECENT_MS = 24 * 3600_000;
export const MAC_SHOWN = 20;
const FIRST_WAIT_MS = 1000;
const LONGEST_WAIT_MS = 30_000;
// How old a row's state on the Mac (at work, waiting for the person) may get while the list is in front.
export const MAC_LOOK_MS = 15_000;

export const macShown = (recent: RecentConversation[], now: number, here: TermSession[] = []) =>
  notGoneOnHere(recent, here).filter((r) => !r.automated && !r.openIn && r.cwd && r.lastActivity > now - MAC_RECENT_MS).slice(0, MAC_SHOWN);

// The conversations no session shown here goes on with: one that starts leaves its conversation out at once,
// before the Mac is asked again.
export function notGoneOnHere(recent: RecentConversation[], here: TermSession[]): RecentConversation[] {
  const followed = new Set(here.flatMap((s) => (s.past ? [] : (s.claudeSessionId ?? s.codexThreadId ?? []))));
  return recent.filter((r) => !followed.has(r.sessionId));
}

// What was kept, to show before anything is asked.
export function keptMacRecent(storage: KeyValue): RecentConversation[] {
  try {
    const v = JSON.parse(storage.getItem(MAC_KEY) ?? 'null');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// What the list last had of one conversation, for its page to be drawn whole before the Mac answers.
export const keptConversation = (storage: KeyValue, sid: string): RecentConversation | undefined =>
  keptMacRecent(storage).find((r) => r.sessionId === sid);

// The rows of `now` in the order `before` had them, those new since first: a row does not move under a finger.
export const inOrderOf = (before: RecentConversation[], now: RecentConversation[]): RecentConversation[] => {
  const at = new Map(before.map((r, n) => [r.sessionId, n]));
  return [...now.filter((r) => !at.has(r.sessionId)), ...now.filter((r) => at.has(r.sessionId)).sort((a, b) => at.get(a.sessionId)! - at.get(b.sessionId)!)];
};

// What the Mac has lately, as kept and then as the Mac says: asked again whenever the app comes back to the
// front, in the Mac's order, and every MAC_LOOK_MS while in front, in the order shown. A failed ask is retried
// until the Mac answers. Only the latest ask is shown, so an older answer arriving late cannot put back what a
// newer one replaced. Returns the way to stop.
export function followMacRecent(deps: { api: Api; storage: KeyValue; visibility: Visibility }, show: (recent: RecentConversation[]) => void): () => void {
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wait = FIRST_WAIT_MS;
  let asked = 0;
  let shown: RecentConversation[] | null = null;
  const load = (reorder: boolean) => {
    clearTimeout(timer);
    if (!deps.visibility.visible()) return;
    const ask = ++asked;
    recentConversations(deps.api).then(
      (r) => {
        if (!alive || ask !== asked) return;
        wait = FIRST_WAIT_MS;
        timer = setTimeout(() => load(false), MAC_LOOK_MS);
        shown = reorder || !shown ? r : inOrderOf(shown, r);
        show(shown);
        try {
          deps.storage.setItem(MAC_KEY, JSON.stringify(r));
        } catch {
          // not kept; the next open waits for the Mac
        }
      },
      () => {
        if (!alive || ask !== asked) return;
        timer = setTimeout(() => load(reorder), wait);
        wait = Math.min(wait * 2, LONGEST_WAIT_MS);
      },
    );
  };
  show(keptMacRecent(deps.storage));
  load(true);
  const unlisten = deps.visibility.onChange(() => {
    if (alive && deps.visibility.visible()) load(true);
  });
  return () => {
    alive = false;
    clearTimeout(timer);
    unlisten();
  };
}
