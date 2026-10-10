import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { beginOp, endOp, opRunning, readLastOp } from '../../../src/ops/lastOp.js';

const home = () => mkdtempSync(join(tmpdir(), 'ts-lastop-'));
const alive = (pids: number[]) => (pid: number) => pids.includes(pid);

describe('beginOp, endOp and readLastOp', () => {
  it('reads none before the first', () => {
    const h = home();
    expect(readLastOp(h)).toBeNull();
    expect(opRunning(h, alive([]))).toBe(false);
  });

  it('reads it as running while its helper lives and has not said how it ended', () => {
    const h = home();
    beginOp(h, 'restart', 4242, 1000);
    expect(readLastOp(h)).toEqual({ op: 'restart', pid: 4242, startedAt: 1000 });
    expect(opRunning(h, alive([4242]))).toBe(true);
  });

  it('reads it as over once the helper has said how it ended, keeping what it said', () => {
    const h = home();
    beginOp(h, 'rollback', 4242, 1000);
    endOp(h, { ok: false, message: 'nothing to roll back to' }, 2000);
    expect(readLastOp(h)).toEqual({ op: 'rollback', pid: 4242, startedAt: 1000, finishedAt: 2000, ok: false, message: 'nothing to roll back to' });
    expect(opRunning(h, alive([4242]))).toBe(false);
  });

  it('reads it as over when its helper died without a word', () => {
    const h = home();
    beginOp(h, 'restart', 4242, 1000);
    expect(opRunning(h, alive([]))).toBe(false);
  });

  it('does not end it from a helper that finds no record', () => {
    const h = home();
    endOp(h, { ok: true, message: 'x' }, 2000);
    expect(readLastOp(h)).toBeNull();
  });
});
