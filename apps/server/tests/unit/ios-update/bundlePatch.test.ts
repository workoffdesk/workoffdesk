import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundlePatcher, keepBundle } from '../../../src/ios-update/bundlePatch.js';
import { applied } from '../../helpers/bspatch.js';

// The iPhone app's bundles this server has offered, kept so the next one goes to a phone as a patch
// against the one it runs.
const id = (n: number) => `0a0b0c0d-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OLD = Buffer.from(Array.from({ length: 400 }, (_, i) => `line ${i} of the bundle\n`).join(''));
const NEW = Buffer.from(OLD.toString().replace('line 200 of', 'line 200, changed, of'));
const folder = () => mkdtempSync(join(tmpdir(), 'ts-bundles-'));

describe('keepBundle', () => {
  it('keeps it whole, under its update id', () => {
    const dir = join(folder(), 'not yet');
    keepBundle(dir, id(1), OLD);
    expect(readFileSync(join(dir, `${id(1)}.bundle`))).toEqual(OLD);
    expect(readdirSync(dir)).toEqual([`${id(1)}.bundle`]);
  });

  it('keeps it as it was first: an id names one bundle', () => {
    const dir = folder();
    keepBundle(dir, id(1), OLD);
    keepBundle(dir, id(1), NEW);
    expect(readFileSync(join(dir, `${id(1)}.bundle`))).toEqual(OLD);
  });

  it('keeps the newest twenty, and nothing else in the folder goes', () => {
    const dir = folder();
    writeFileSync(join(dir, 'notes.txt'), '');
    for (let n = 1; n <= 21; n++) {
      keepBundle(dir, id(n), OLD);
      utimesSync(join(dir, `${id(n)}.bundle`), n * 1000, n * 1000);
    }
    keepBundle(dir, id(22), OLD);
    const kept = readdirSync(dir).sort();
    expect(kept).toHaveLength(21);
    expect(kept).toContain('notes.txt');
    expect(kept).toContain(`${id(22)}.bundle`);
    expect(kept).not.toContain(`${id(1)}.bundle`);
    expect(kept).not.toContain(`${id(2)}.bundle`);
    expect(kept).toContain(`${id(3)}.bundle`);
  });
});

describe('bundlePatcher', () => {
  it('turns the bundle the phone runs into this one, and is much smaller than it', async () => {
    const dir = folder();
    keepBundle(dir, id(1), OLD);
    const patch = await bundlePatcher(dir, NEW)(id(1));
    expect(patch).not.toBeNull();
    expect(patch!.length).toBeLessThan(NEW.length / 4);
    expect(await applied(OLD, patch!)).toEqual(NEW);
  });

  it('makes a patch once for each bundle it starts from, however often it is asked for', async () => {
    const dir = folder();
    keepBundle(dir, id(1), OLD);
    const patchFrom = bundlePatcher(dir, NEW);
    const first = patchFrom(id(1));
    expect(patchFrom(id(1).toUpperCase())).toBe(first);
    rmSync(join(dir, `${id(1)}.bundle`));
    expect(await patchFrom(id(1))).toEqual(await first);
  });

  it.each([
    ['a bundle this server never kept', id(2)],
    ['an id that is not one', 'latest'],
    ['a path', `../${id(1)}`],
    ['an empty id', ''],
  ])('has no patch for %s: the phone downloads the whole bundle', async (_, base) => {
    const root = folder();
    const dir = join(root, 'bundles');
    keepBundle(dir, id(1), OLD);
    keepBundle(root, id(1), OLD);
    expect(await bundlePatcher(dir, NEW)(base)).toBeNull();
  });

  it('has no patch when the folder is gone', async () => {
    expect(await bundlePatcher(join(folder(), 'none'), NEW)(id(1))).toBeNull();
  });
});
