import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from '../system/paths.js';

// The last restart or rollback asked for from a screen, and how it ended. The server writes it as it hands
// the work to a helper process (it cannot restart itself), and the helper writes how it ended.

export type OpKind = 'restart' | 'rollback';
export type LastOp = { op: OpKind; pid: number; startedAt: number; finishedAt?: number; ok?: boolean; message?: string };

const fileOf = (home: string) => join(home, 'ops.json');

export function readLastOp(home: string): LastOp | null {
  try {
    const r = JSON.parse(readFileSync(fileOf(home), 'utf8')) as LastOp;
    return typeof r?.op === 'string' && typeof r.pid === 'number' ? r : null;
  } catch {
    return null;
  }
}

export const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export function opRunning(home: string, alive: (pid: number) => boolean = pidAlive): boolean {
  const last = readLastOp(home);
  return !!last && last.finishedAt === undefined && alive(last.pid);
}

export function beginOp(home: string, op: OpKind, pid: number, now = Date.now()): void {
  writeJsonAtomic(fileOf(home), { op, pid, startedAt: now } satisfies LastOp);
}

export function endOp(home: string, outcome: { ok: boolean; message: string }, now = Date.now()): void {
  const last = readLastOp(home);
  if (last) writeJsonAtomic(fileOf(home), { ...last, finishedAt: now, ...outcome } satisfies LastOp);
}
