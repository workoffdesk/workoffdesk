import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../../../..');
const SELF = relative(ROOT, __filename);
// The comparison table names another project of that name, and the iPhone app is published as Work Offdesk;
// nothing else may.
const ALLOWED = /zalify\/offdesk|\bWork Offdesk\b/g;
const OLD = /(?<!work)offdesk|term-?site|term\.example|ts_session|outsite/i;

const tracked = () => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const named = (f: string) => OLD.test(readFileSync(join(ROOT, f), 'utf8').replace(ALLOWED, ''));

describe('the name', () => {
  it('is workoffdesk everywhere', () => {
    const files = tracked();
    expect(files.length, 'git ls-files sees the repository').toBeGreaterThan(100);
    expect(files, 'the guard reads this file too').toContain(SELF);
    const stray = files.filter((f) => f !== SELF && !/\.(png|jpe?g|gif|webp|ico|icns)$/.test(f)).filter(named);
    expect(stray).toEqual([]);
  });

  it('finds the old name in a file that has it', () => {
    expect(named(SELF)).toBe(true);
  });
});
