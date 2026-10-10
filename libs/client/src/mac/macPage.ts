import { t, type Lang } from '@workoffdesk/i18n';
import { errorText, type Api, type Limit } from '../base/api';

// The This Mac page (routes/mac.ts on the server): the Mac's checks, its build, what went wrong lately, and a
// restart or a rollback, which the page waits out while the server is away.

export type MacCheck = { id: string; ok: boolean; detail: string; fix?: string };
export type MacRelease = { name: string; version: string; activatedAt: string | null };
export type MacOpRecord = { op: 'restart' | 'rollback'; pid: number; startedAt: number; finishedAt?: number; ok?: boolean; message?: string };
export type MacReport = {
  checks: MacCheck[];
  version: string;
  build: { version: string; commit: string | null; dirty: boolean } | null;
  release: string | null;
  releases: MacRelease[];
  rollbackTo: string | null;
  managed: boolean;
  // When the server process started: a restart moves it.
  startedAt: number;
  lastOp: MacOpRecord | null;
};
// A Claude account on the Mac (agents/claude/accounts.ts on the server); id: its config dir, "" the default.
export type ClaudeAccount = {
  id: string;
  folder: string;
  email: string;
  signedIn: boolean;
  ready: boolean;
  shared: boolean;
  limits: { fiveHour?: Limit; sevenDay?: Limit; at: number } | null;
};
// elsewhere: the open sessions on another account; moving: those of them to move once their turn is over.
export type ClaudeAccounts = { accounts: ClaudeAccount[]; inUse: string; picked: boolean; elsewhere: number; moving: number };
export type MacProblem = { at: string; level: 'warn' | 'error' | 'fatal'; msg: string; detail: string };

// asking: the request is on its way; waiting: the Mac took it and the page waits for its outcome.
export type MacOp = { kind: 'restart' | 'rollback'; phase: 'asking' | 'waiting' | 'done' | 'failed'; message: string | null };
// What a restart or rollback under way, or just over, is doing, in words.
export const opWords = (op: MacOp) => {
  if (op.phase === 'asking' || op.phase === 'waiting') return op.kind === 'restart' ? t.macRestarting : t.macRollingBack;
  if (op.phase === 'done') return op.kind === 'restart' ? t.macRestarted : t.macRolledBack;
  return op.message ?? t.failed;
};
// picking: the account a tap asked for, until the server answers; moveAsked: the same, for moving the open sessions.
export type MacPageSnapshot = {
  report: MacReport | null;
  problems: MacProblem[] | null;
  error: string | null;
  op: MacOp | null;
  accounts: ClaudeAccounts | null;
  picking: string | null;
  moveAsked: boolean;
};

export const MAC_POLL_MS = 1000;
export const MAC_WAIT_MS = 60_000;
// How often the accounts are asked for while sessions wait to move.
export const MOVES_POLL_MS = 3000;

export function createMacPage(api: Api, lang: Lang) {
  const listeners = new Set<() => void>();
  let snapshot: MacPageSnapshot = { report: null, problems: null, error: null, op: null, accounts: null, picking: null, moveAsked: false };
  let held = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let movesTimer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: Partial<MacPageSnapshot>) => {
    if (!held) return;
    snapshot = { ...snapshot, ...next };
    for (const l of listeners) l();
  };
  const getReport = () => api<MacReport>(`/api/mac?lang=${lang}`);

  const loadProblems = () =>
    api<MacProblem[]>('/api/mac/problems').then(
      (problems) => set({ problems }),
      () => set({ problems: snapshot.problems ?? [] }),
    );

  const load = () => {
    getReport().then(
      (report) => set({ report, error: null }),
      (e) => set({ error: errorText(e, t.loadFailed) }),
    );
    void loadProblems();
    loadAccounts();
  };

  // While sessions wait for their turn to end to move, the list is asked for again until none do.
  const showAccounts = (accounts: ClaudeAccounts) => {
    set({ accounts });
    followMoves();
  };
  const followMoves = () => {
    clearTimeout(movesTimer);
    if (held && snapshot.accounts?.moving) movesTimer = setTimeout(loadAccounts, MOVES_POLL_MS);
  };
  const loadAccounts = () => {
    api<ClaudeAccounts>('/api/claude/accounts').then(showAccounts, followMoves);
  };

  // Asked of the server each second until the operation it took says how it ended. A server that is down
  // in between fails these, which is what a restart looks like from here.
  const waitFor = (kind: MacOp['kind'], before: number | undefined) => {
    const since = Date.now();
    const poll = () => {
      timer = setTimeout(() => {
        getReport().then(
          (report) => {
            const last = report.lastOp;
            if (!last || last.startedAt === before || last.finishedAt === undefined) return next();
            set({ report, op: { kind, phase: last.ok ? 'done' : 'failed', message: last.ok ? null : (last.message ?? t.failed) } });
            void loadProblems();
          },
          () => next(),
        );
      }, MAC_POLL_MS);
    };
    const next = () => {
      if (!held) return;
      if (Date.now() - since >= MAC_WAIT_MS) set({ op: { kind, phase: 'failed', message: t.macNoReturn } });
      else poll();
    };
    poll();
  };

  const run = (kind: MacOp['kind'], path: string, json: object) => {
    const running = snapshot.op?.phase === 'asking' || snapshot.op?.phase === 'waiting';
    if (!held || running) return;
    const before = snapshot.report?.lastOp?.startedAt;
    set({ op: { kind, phase: 'asking', message: null } });
    api(path, { method: 'POST', json }).then(
      () => {
        set({ op: { kind, phase: 'waiting', message: null } });
        if (held) waitFor(kind, before);
      },
      (e) => set({ op: { kind, phase: 'failed', message: errorText(e, t.failed) } }),
    );
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    load,
    restart: () => run('restart', '/api/mac/restart', {}),
    // to: the release the page named, which the server checks is still the one before.
    rollback: (to: string) => run('rollback', '/api/mac/rollback', { to }),
    // A tap on an account: new sessions start on it. The list then says what the server took.
    pick(id: string) {
      if (!held || snapshot.picking !== null) return;
      set({ picking: id });
      api<ClaudeAccounts>('/api/claude/account', { method: 'PUT', json: { id }, idempotent: true }).then(
        (accounts) => (set({ picking: null }), showAccounts(accounts)),
        (e) => set({ picking: null, error: errorText(e, t.failed) }),
      );
    },
    // The open sessions on another account move to the one in use, each once its turn is over.
    move() {
      if (!held || snapshot.moveAsked) return;
      set({ moveAsked: true });
      api<ClaudeAccounts>('/api/claude/account/move', { method: 'POST', idempotent: true }).then(
        (accounts) => (set({ moveAsked: false }), showAccounts(accounts)),
        (e) => set({ moveAsked: false, error: errorText(e, t.failed) }),
      );
    },
    // Held while the page shows: loads at once; let go, it asks nothing more and changes nothing.
    hold() {
      held = true;
      load();
      return () => {
        held = false;
        clearTimeout(timer);
        clearTimeout(movesTimer);
      };
    },
  };
}

export type MacPage = ReturnType<typeof createMacPage>;
