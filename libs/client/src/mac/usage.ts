import { t } from '@workoffdesk/i18n';
import type { Limit, Usage } from '../base/api';
import type { ModelChoice } from '../model/chat';
import { timeAgo } from '../model/format';
import type { ClaudeAccount } from './macPage';

// From this much used on, a figure shows as running out.
export const HIGH = 80;

export const pct = (n: number) => `${Math.round(n)}%`;

export type UsageLine = { label: string; value: string; sub?: string; high?: boolean };

// How long until a limit resets, from its Unix-seconds time.
export function resetIn(resetsAt: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((resetsAt * 1000 - now) / 60_000));
  if (min < 60) return t.resetsInMinutes(min);
  const h = Math.floor(min / 60);
  if (h < 24) return t.resetsInHours(h, min % 60);
  return t.resetsInDays(Math.floor(h / 24), h % 24);
}

// What the session has used, a line a figure, as its usage menu lists it; first the account it runs on, when
// the Mac has more than one.
export function usageLines(u: Usage, now = Date.now(), account?: string): UsageLine[] {
  const lines: UsageLine[] = account ? [{ label: t.claudeAccountLine, value: account }] : [];
  if (u.context !== undefined) lines.push({ label: t.context, value: pct(u.context), high: u.context >= HIGH });
  for (const [label, limit] of [[t.fiveHourLimit, u.fiveHour], [t.sevenDayLimit, u.sevenDay]] as const)
    if (limit) lines.push({ label, value: pct(limit.used), sub: limit.resetsAt ? resetIn(limit.resetsAt, now) : undefined, high: limit.used >= HIGH });
  if (u.cost !== undefined) lines.push({ label: t.sessionCost, value: `$${u.cost.toFixed(2)}` });
  if (u.added || u.removed) lines.push({ label: t.linesChanged, value: t.lines(u.added ?? 0, u.removed ?? 0) });
  return lines;
}

// The same, as text to copy.
export const usageText = (u: Usage, lines: UsageLine[]) =>
  [u.model, ...lines.map((l) => `${l.label} ${l.value}${l.sub ? ` (${l.sub})` : ''}`)].filter(Boolean).join('\n');

// The one figure the session pill shows: the context, or a limit when that is the one running out.
export type PillFigure = { label: string; accessibilityLabel: string; high: boolean };

// What the pill under the composer shows and does: the model, the permission mode and the effort, each a menu.
// models: what /model takes in the session, as Claude Code lists it.
export type SessionPillProps = {
  usage: Usage | null | undefined;
  mode: string | null | undefined;
  models?: ModelChoice[] | null;
  switching?: boolean;
  // The model and effort shown and not switched from here, and no permission mode: an agent other than Claude Code.
  fixed?: boolean;
  // The Claude account the session runs on, said in its usage menu; only on a Mac with more than one.
  account?: string;
  onCommand: (command: string) => void;
  onMode: (mode: string | null) => void;
};

// The red follows the number it is next to: a limit running out is shown itself, not as a red context.
export function pillFigure(u: Usage): PillFigure | null {
  const context = u.context !== undefined && { label: t.contextLabel(pct(u.context)), accessibilityLabel: t.contextIs(pct(u.context)), high: u.context >= HIGH };
  if (context && context.high) return context;
  for (const [limit, name, label] of [[u.fiveHour, t.fiveHourLimit, t.fiveHourLabel], [u.sevenDay, t.sevenDayLimit, t.sevenDayLabel]] as const)
    if (limit && limit.used >= HIGH) return { label: label(pct(limit.used)), accessibilityLabel: t.limitIs(name, pct(limit.used)), high: true };
  return context || null;
}

// Why an account cannot be picked, or null when it can.
export const accountBar = (a: ClaudeAccount): string | null =>
  !a.signedIn ? t.accountSignedOut : !a.ready ? t.accountNotReady : !a.shared ? t.accountApart : null;

// What an account used when its sessions last said: a limit past its reset says so, not its old figure.
function accountUsed(a: ClaudeAccount, now = Date.now()): string {
  if (!a.limits) return t.accountNotSeen;
  const part = (l: Limit | undefined, label: (p: string) => string) =>
    l && label(l.resetsAt !== undefined && l.resetsAt * 1000 <= now ? t.limitReset : pct(l.used));
  const parts = [part(a.limits.fiveHour, t.fiveHourLabel), part(a.limits.sevenDay, t.sevenDayLabel)].filter(Boolean);
  return parts.length ? `${parts.join(' · ')} · ${timeAgo(a.limits.at, now)}` : t.accountNotSeen;
}

// The line under an account: its folder, then why it cannot be picked or else what it used.
export const accountLine = (a: ClaudeAccount, now = Date.now()): string => `${a.folder} · ${accountBar(a) ?? accountUsed(a, now)}`;
