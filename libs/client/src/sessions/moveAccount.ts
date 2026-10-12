import { t } from '@workoffdesk/i18n';
import { errorText, MACHINE, type Api, type TermSession } from '../base/api';
import { chatEntries } from '../chat/chatEntries';
import { accountBar, accountLine } from '../mac/usage';
import type { ClaudeAccount, ClaudeAccounts } from '../mac/macPage';
import { isLimit } from '../model/chat';
import type { SessionSnapshot } from './session';

// The accounts a Claude session can go on on once its own hit a limit: those that can be picked, but for the one
// it runs on (by its email; the one in use when not known) and any other folder of that same account.
export function accountsToMoveTo(view: ClaudeAccounts, runsOn: string | undefined): ClaudeAccount[] {
  const own = runsOn ?? view.accounts.find((a) => a.id === view.inUse)?.email;
  return view.accounts.filter((a) => a.email !== own && accountBar(a) === null);
}

// An account offered to go on on: its folder, and its limits when any were seen.
export const moveOptionLine = (a: ClaudeAccount) => (a.limits ? accountLine(a) : a.folder);

// The chat stopped on its account's limit, and has not gone on since: its last turn the limit, offered to go on from.
export function limitStopped(s: Pick<SessionSnapshot, 'view' | 'status'> & { queued: number }): boolean {
  const { entries } = chatEntries({ kind: 'claude', view: s.view, status: s.status, answers: [], queued: s.queued, dialog: false });
  return entries.some((e) => e.kind === 'turn' && e.retry && isLimit(e.turn));
}

// asking: what to say once moved, and whether it was typed (and so goes back to the box when not moved);
// moving: the account asked for, until the Mac answers; waiting: what to say once the session runs on that account.
export type AccountMoveSnapshot = {
  accounts: ClaudeAccount[] | null;
  asking: { text: string; typed: boolean } | null;
  moving: string | null;
  waiting: { email: string; text: string } | null;
  error: string | null;
};

// A session stopped on a limit going on on another account: the account is picked for the Mac, this session moves
// to it, the Mac saying why when it does not, then the other open sessions (routes/claude.ts). What was asked for
// is said only once this session runs there, so it never reaches the Claude still on the old account.
export function createAccountMove(api: Api, sessionId: string, send: (text: string) => void) {
  const listeners = new Set<() => void>();
  let snapshot: AccountMoveSnapshot = { accounts: null, asking: null, moving: null, waiting: null, error: null };
  const set = (patch: Partial<AccountMoveSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    load: (runsOn: string | undefined) =>
      api<ClaudeAccounts>('/api/claude/accounts').then(
        (view) => set({ accounts: accountsToMoveTo(view, runsOn) }),
        () => {},
      ),
    offer: (text: string, typed: boolean) => set({ asking: { text, typed }, error: null }),
    // Not moved: what was typed, for the box to have again.
    dismiss() {
      const typed = snapshot.asking?.typed ? snapshot.asking.text : null;
      set({ asking: null, error: null });
      return typed;
    },
    async move(id: string) {
      const asking = snapshot.asking;
      const to = snapshot.accounts?.find((a) => a.id === id);
      if (!asking || !to || snapshot.moving !== null) return;
      set({ moving: id, error: null });
      try {
        await api<ClaudeAccounts>('/api/claude/account', { method: 'PUT', json: { id }, idempotent: true });
        await api<TermSession>(`/api/m/${MACHINE}/sessions/${sessionId}/move`, { method: 'POST', idempotent: true });
        set({ asking: null, moving: null, waiting: { email: to.email, text: asking.text } });
        await api<ClaudeAccounts>('/api/claude/account/move', { method: 'POST', idempotent: true }).catch(() => {});
      } catch (e) {
        set({ moving: null, error: errorText(e, t.failed) });
      }
    },
    // The account the session runs on, as the page last heard.
    seen(runsOn: string | undefined) {
      const waiting = snapshot.waiting;
      if (!waiting || runsOn !== waiting.email) return;
      set({ waiting: null });
      send(waiting.text);
    },
  };
}

export type AccountMove = ReturnType<typeof createAccountMove>;
