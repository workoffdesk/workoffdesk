import { lang, t } from '@workoffdesk/i18n';
import { isAgent, type SessionKind } from '../base/api';

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return t.justNow;
  const m = Math.round(s / 60);
  if (m < 60) return t.minutesAgo(m);
  const h = Math.round(m / 60);
  if (h < 24) return t.hoursAgo(h);
  const d = Math.round(h / 24);
  if (d < 30) return t.daysAgo(d);
  return new Date(ms).toLocaleDateString(LOCALE);
}

export function shortPath(p: string | null): string {
  if (!p) return '';
  const home = p.match(/^\/Users\/[^/]+/)?.[0];
  return home ? `~${p.slice(home.length)}` : p;
}

export function dirName(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() ?? cwd;
}

// The name given to a session, '' while it goes by its directory's.
export function ownName(s: { title: string; cwd: string }): string {
  return s.title === dirName(s.cwd) ? '' : s.title;
}

export const STATUS_LABEL = t.status;

// What a session's chip says: that it has ended, whatever it ran; else what Claude is doing, or what it runs.
export function statusLabel(s: { kind: SessionKind; status: keyof typeof STATUS_LABEL | null }): string {
  if (s.status === 'ended') return STATUS_LABEL.ended;
  if (!isAgent(s.kind)) return 'Shell';
  return s.status ? STATUS_LABEL[s.status] : s.kind === 'codex' ? 'Codex' : 'Claude';
}

const LOCALE = lang === 'zh' ? 'zh-CN' : 'en-US';
const WEEKDAY = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' });
const MONTH_DAY = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' });
const DATE = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'numeric', day: 'numeric' });
const DAY_MS = 24 * 60 * 60 * 1000;

// When, as a chat list puts it: the clock today, then yesterday, a weekday within the week, a date.
export function listTime(ms: number, now = Date.now()): string {
  const at = new Date(ms);
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(new Date(now)) - midnight(at)) / DAY_MS);
  if (days <= 0) return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  if (days === 1) return t.yesterday;
  if (days < 7) return WEEKDAY.format(at);
  if (at.getFullYear() === new Date(now).getFullYear()) return MONTH_DAY.format(at);
  return DATE.format(at);
}

// The line under a session's name: what Claude is doing when that is news, else what it said last,
// else where the session is.
export function sessionPreview(s: { kind: SessionKind; status: keyof typeof STATUS_LABEL | null; cwd: string; lastReply?: string | null }): string {
  const agent = isAgent(s.kind);
  if (agent && s.status === 'starting') return t.previewStarting;
  if (agent && s.status === 'working') return t.previewWorking;
  if (agent && s.status === 'compacting') return t.compactingContext;
  if (agent && (s.status === 'waiting' || s.status === 'ended')) return STATUS_LABEL[s.status];
  return s.lastReply || shortPath(s.cwd);
}

// How long something took, to the second.
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? t.seconds(s) : t.minutesSeconds(Math.floor(s / 60), s % 60);
}

// The time of day a transcript time stands for, as HH:MM; empty when there is none.
export function clock(iso: string | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// A signed-in device as the settings list names it, from the user agent it signed in with. The iPhone app
// names itself WorkOffDesk/<version>.
export function deviceLabel(ua: string): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : t.device;
  const browser = /^WorkOffDesk\//.test(ua)
    ? 'WorkOffDesk'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /CriOS|Chrome\//.test(ua)
        ? 'Chrome'
        : /FxiOS|Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  return browser ? `${os} · ${browser}` : os;
}
