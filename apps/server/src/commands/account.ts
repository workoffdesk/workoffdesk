import type { AccountsView } from '../agents/claude/accounts.js';
import { askAccounts, askToMove, askToPick } from '../sessions/control.js';
import { m, type Messages } from '../system/messages.js';
import { homeDir, socketPath } from '../system/paths.js';
import type { Limit } from '../system/store.js';
import { fail } from './common.js';

type Words = Messages['account'];
type Account = AccountsView['accounts'][number];

// The account an email or folder names. An email more than one account has names none of them.
export function findAccount(view: AccountsView, who: string, w: Words): string {
  const byFolder = view.accounts.find((a) => a.folder === who || (a.id && a.id === who));
  if (byFolder) return byFolder.id;
  const byEmail = view.accounts.filter((a) => a.email.toLowerCase() === who.toLowerCase());
  if (byEmail.length > 1) throw new Error(w.twoWithEmail(byEmail[0].email, byEmail.map((a) => a.folder)));
  if (!byEmail.length) throw new Error(w.noSuch(who));
  return byEmail[0].id;
}

// Why an account cannot be picked, else what it used when its sessions last said; a limit past its reset is reset.
function said(a: Account, w: Words, now: number): string {
  if (!a.signedIn) return w.signedOut;
  if (!a.ready) return w.notReady;
  if (!a.shared) return w.apart;
  const part = (l: Limit | undefined, label: (p: string) => string) =>
    l && label(l.resetsAt !== undefined && l.resetsAt * 1000 <= now ? w.reset : `${Math.round(l.used)}%`);
  const parts = [part(a.limits?.fiveHour, w.fiveHour), part(a.limits?.sevenDay, w.sevenDay)].filter(Boolean);
  return parts.length ? parts.join(' · ') : w.notSeen;
}

// A line an account, the one in use checked; then the open sessions on another account, and those moving to it.
export function accountLines(view: AccountsView, w: Words, now = Date.now()): string[] {
  const emails = Math.max(...view.accounts.map((a) => a.email.length));
  const folders = Math.max(...view.accounts.map((a) => a.folder.length));
  const lines = view.accounts.map(
    (a) => `${a.id === view.inUse ? '✓' : ' '} ${a.email.padEnd(emails)}  ${a.folder.padEnd(folders)}  ${said(a, w, now)}`,
  );
  const sessions = [view.elsewhere && w.elsewhere(view.elsewhere), view.moving && w.moving(view.moving)].filter((l): l is string => !!l);
  return sessions.length ? [...lines, '', ...sessions] : lines;
}

export async function account(args: string[]) {
  const sock = socketPath(homeDir(), 'control.sock');
  const w = m.account;
  const [sub, ...rest] = args;
  const show = (view: AccountsView) => console.log(accountLines(view, w).join('\n'));
  try {
    if (sub === undefined) return show(await askAccounts(sock));
    if (sub === '--json') return console.log(JSON.stringify(await askAccounts(sock)));
    if (sub === 'move') return show(await askToMove(sock));
    const who = rest.find((a) => !a.startsWith('--'));
    if (sub !== 'use' || !who) return fail(w.usage);
    const view = await askToPick(sock, findAccount(await askAccounts(sock), who, w));
    show(rest.includes('--move') ? await askToMove(sock) : view);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ECONNREFUSED') fail(m.cli.notRunning);
    fail(code === 'account-none-picked' ? w.nonePicked : (e as Error).message);
  }
}
