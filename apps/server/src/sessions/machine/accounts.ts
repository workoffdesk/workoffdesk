import type { AccountsView } from '../../agents/claude/accounts.js';
import type { Usage } from '../../agents/claude/usage.js';
import { Conflict } from '../../system/errors.js';
import type { Limit, SessionMeta } from '../../system/store.js';
import type { MachineDeps, Parts } from './state.js';

// The Claude accounts on the Mac: the one new sessions run on, and each one's last limits.
export class Accounts {
  constructor(
    private readonly d: MachineDeps,
    private readonly p: Parts,
  ) {}

  // Written when a figure moves by a whole point or a reset time changes, not on every status line.
  keepLimits(dir: string, u: Usage): void {
    const before = this.d.store.get().claudeLimits?.[dir];
    const same = (a?: Limit, b?: Limit) => Math.round(a?.used ?? -1) === Math.round(b?.used ?? -1) && a?.resetsAt === b?.resetsAt;
    if (before && same(before.fiveHour, u.fiveHour) && same(before.sevenDay, u.sevenDay)) return;
    this.d.store.update((st) => {
      st.claudeLimits = { ...st.claudeLimits, [dir]: { fiveHour: u.fiveHour, sevenDay: u.sevenDay, at: Date.now() } };
    });
  }

  // The account new sessions here run on: the one picked while it can still be, else this server's own.
  // undefined: none was ever picked, and the start command says nothing of accounts.
  async accountInUse(): Promise<string | undefined> {
    const picked = this.d.store.get().claudeAccount;
    if (picked === undefined || !this.d.accounts) return undefined;
    const found = (await this.d.accounts.list()).find((a) => a.id === picked);
    return found && this.d.accounts.pickable(found) ? picked : this.d.accounts.ownId();
  }

  async claudeAccountsView(): Promise<AccountsView> {
    const accounts = this.d.accounts ? await this.d.accounts.list() : [];
    const limits = this.d.store.get().claudeLimits ?? {};
    const inUse = await this.accountInUse();
    return {
      accounts: accounts.map((a) => ({ ...a, limits: limits[a.id] ?? null })),
      inUse: inUse ?? this.d.accounts?.ownId() ?? '',
      picked: this.d.store.get().claudeAccount !== undefined,
      ...this.p.moves.counts(inUse),
    };
  }

  // The id is one of the accounts found, never taken as a path of its own.
  async pickClaudeAccount(id: string): Promise<AccountsView> {
    const found = this.d.accounts && (await this.d.accounts.list()).find((a) => a.id === id);
    if (!found || !this.d.accounts?.pickable(found)) throw new Conflict('that Claude account cannot be used now', 'account-unusable');
    this.d.store.update((st) => void (st.claudeAccount = id));
    return this.claudeAccountsView();
  }

  // Which account a Claude session runs on, said only on a Mac with more than one.
  accountLabel(meta: SessionMeta): string | undefined {
    const known = this.d.accounts?.known() ?? [];
    if (meta.kind !== 'claude' || meta.claudeDir === undefined || known.length < 2) return undefined;
    return known.find((a) => a.id === meta.claudeDir)?.email;
  }
}
