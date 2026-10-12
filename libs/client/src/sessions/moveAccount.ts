import { t } from '@workoffdesk/i18n';
import { ApiError, errorText, MACHINE, type Api, type TermSession } from '../base/api';
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

// A session that can be offered another account now: a Claude one, with one to go to, not on its way to one.
export const canMoveAccount = (kind: string | null, s: Pick<AccountMoveSnapshot, 'accounts' | 'waiting'>) =>
  kind === 'claude' && !!s.accounts?.length && !s.waiting;

// The chat stopped on its account's limit, and has not gone on since: its last turn the limit, offered to go on from.
export function limitStopped(s: Pick<SessionSnapshot, 'view' | 'status'> & { queued: number }): boolean {
  const { entries } = chatEntries({ kind: 'claude', view: s.view, status: s.status, answers: [], queued: s.queued, dialog: false });
  return entries.some((e) => e.kind === 'turn' && e.retry && isLimit(e.turn));
}

// asking: what to say once moved (none when asked from the menu), and whether it was typed (and so goes back to the
// box when not moved); moving: the account asked for, until the Mac answers; blocked: the account the Mac would not
// move to for something at work, to move to now or once free; waiting: what to say once the session runs there.
export type AccountMoveSnapshot = {
  accounts: ClaudeAccount[] | null;
  asking: { text: string; typed: true } | { text: string | null; typed: false } | null;
  moving: string | null;
  blocked: string | null;
  waiting: { email: string; text: string | null } | null;
  error: string | null;
};

// Refusals for something at work, which moving now or once it is free gets past.
const AT_WORK = new Set(['session-busy', 'open-on-mac-busy']);

// A session stopped on a limit going on on another account: the account is picked for the Mac, this session moves
// to it, the Mac saying why when it does not, then the other open sessions (routes/claude.ts). What was asked for
// is said only once this session runs there, so it never reaches the Claude still on the old account.
export function createAccountMove(api: Api, sessionId: string, send: (text: string) => void) {
  const listeners = new Set<() => void>();
  let snapshot: AccountMoveSnapshot = { accounts: null, asking: null, moving: null, blocked: null, waiting: null, error: null };
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
    offer: (text: string | null, typed = false) =>
      set({ asking: typed && text !== null ? { text, typed } : { text, typed: false }, blocked: null, error: null }),
    // Not moved: what was typed, for the box to have again.
    dismiss() {
      const typed = snapshot.asking?.typed ? snapshot.asking.text : null;
      set({ asking: null, blocked: null, error: null });
      return typed;
    },
    // when: as the Mac takes it, once it said something is at work (blocked).
    async move(id: string, when?: 'now' | 'free') {
      const asking = snapshot.asking;
      const to = snapshot.accounts?.find((a) => a.id === id);
      if (!asking || !to || snapshot.moving !== null) return;
      set({ moving: id, blocked: null, error: null });
      try {
        await api<ClaudeAccounts>('/api/claude/account', { method: 'PUT', json: { id }, idempotent: true });
        await api<TermSession>(`/api/m/${MACHINE}/sessions/${sessionId}/move`, { method: 'POST', json: when && { when }, idempotent: true });
        set({ asking: null, moving: null, waiting: { email: to.email, text: asking.text } });
        await api<ClaudeAccounts>('/api/claude/account/move', { method: 'POST', idempotent: true }).catch(() => {});
      } catch (e) {
        const atWork = e instanceof ApiError && !!e.code && AT_WORK.has(e.code);
        set({ moving: null, blocked: atWork ? id : null, error: errorText(e, t.failed) });
      }
    },
    // The account the session runs on, as the page last heard.
    seen(runsOn: string | undefined) {
      const waiting = snapshot.waiting;
      if (!waiting || runsOn !== waiting.email) return;
      set({ waiting: null });
      if (waiting.text !== null) send(waiting.text);
    },
  };
}

export type AccountMove = ReturnType<typeof createAccountMove>;
