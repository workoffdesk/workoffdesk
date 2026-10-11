import { t } from '@workoffdesk/i18n';
import { errorText, type Api, type RecentConversation } from '../base/api';
import { dayTitle } from '../model/format';

// Every conversation on the Mac not held by a session here (GET /api/conversations), newest first, a page at a
// time, searched by what is typed once typing pauses.
export const HISTORY_PAGE = 50;
export const SEARCH_WAIT_MS = 300;

export type HistoryDay = { title: string; rows: RecentConversation[] };
export type MacHistoryState = { rows: RecentConversation[]; q: string; more: boolean; loading: boolean; error: string | null };
type Page = { conversations: RecentConversation[]; more: boolean };

// Rows that come newest first, under the day each happened.
export function byDay(rows: RecentConversation[], now = Date.now()): HistoryDay[] {
  const days: HistoryDay[] = [];
  for (const r of rows) {
    const title = dayTitle(r.lastActivity, now);
    const last = days.at(-1);
    if (last?.title === title) last.rows.push(r);
    else days.push({ title, rows: [r] });
  }
  return days;
}

export type MacHistory = ReturnType<typeof createMacHistory>;

export function createMacHistory(api: Api) {
  let state: MacHistoryState = { rows: [], q: '', more: false, loading: false, error: null };
  const listeners = new Set<() => void>();
  let asked = 0;
  let typing: ReturnType<typeof setTimeout> | undefined;
  const set = (change: Partial<MacHistoryState>) => {
    state = { ...state, ...change };
    for (const l of [...listeners]) l();
  };

  // Only the latest ask is shown. A next page is asked from just after the last row's time, so rows that share
  // it are not lost at a page's edge; those already shown are not shown again.
  const ask = (next: boolean) => {
    clearTimeout(typing);
    const n = ++asked;
    const last = next ? state.rows.at(-1) : undefined;
    const params = new URLSearchParams({
      ...(state.q ? { q: state.q } : {}),
      ...(last ? { before: String(last.lastActivity + 1) } : {}),
      limit: String(HISTORY_PAGE),
    });
    set({ loading: true, error: null });
    api<Page>(`/api/conversations?${params}`).then(
      (page) => {
        if (n !== asked) return;
        const shown = new Set(next ? state.rows.map((r) => r.sessionId) : []);
        const fresh = page.conversations.filter((r) => !shown.has(r.sessionId));
        set({ rows: next ? [...state.rows, ...fresh] : fresh, more: page.more && fresh.length > 0, loading: false });
      },
      (e: unknown) => {
        if (n === asked) set({ loading: false, error: errorText(e, t.loadFailed) });
      },
    );
  };

  return {
    // For React's useSyncExternalStore.
    getSnapshot: (): MacHistoryState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    reload: () => ask(false),
    loadMore() {
      if (state.more && !state.loading) ask(true);
    },
    search(q: string) {
      clearTimeout(typing);
      set({ q });
      typing = setTimeout(() => ask(false), SEARCH_WAIT_MS);
    },
    // Asked for while a screen shows it; let go, what was on its way is not taken.
    hold(): () => void {
      ask(false);
      return () => {
        clearTimeout(typing);
        asked++;
      };
    },
  };
}
