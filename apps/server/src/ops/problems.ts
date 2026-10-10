import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

// The warnings and errors in the server's log, for someone looking at the Mac from a screen. The log is
// pino's, written through REDACT (log.ts), so what is censored there is censored here.

export type Problem = { at: string; level: 'warn' | 'error' | 'fatal'; msg: string; detail: string };

export const DETAIL_MAX = 4096;
// Enough of the end of a file for any number of problems shown, without reading 10 MB each time.
const TAIL_BYTES = 2 * 1024 * 1024;
const LEVELS: Record<number, Problem['level']> = { 40: 'warn', 50: 'error', 60: 'fatal' };

function tail(file: string): string {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return '';
  }
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, size - length);
    const text = buf.toString('utf8');
    // A tail that starts mid-line drops that line.
    return length < size ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    closeSync(fd);
  }
}

function parse(text: string): Problem | null {
  let line: Record<string, unknown>;
  try {
    line = JSON.parse(text);
  } catch {
    return null;
  }
  const { level, time, msg, pid: _pid, hostname: _host, ...rest } = line ?? {};
  const named = typeof level === 'number' ? LEVELS[Math.min(60, Math.floor(level / 10) * 10)] : undefined;
  if (!named || typeof time !== 'number') return null;
  return { at: new Date(time).toISOString(), level: named, msg: typeof msg === 'string' ? msg : '', detail: JSON.stringify(rest).slice(0, DETAIL_MAX) };
}

export function recentProblems(logFile: string, limit = 50): Problem[] {
  const found: Problem[] = [];
  for (const file of [logFile, `${logFile}.1`]) {
    const lines = tail(file).split('\n');
    for (let i = lines.length - 1; i >= 0 && found.length < limit; i--) {
      const p = lines[i] && parse(lines[i]);
      if (p) found.push(p);
    }
    if (found.length >= limit) break;
  }
  return found;
}
