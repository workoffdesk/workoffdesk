import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scripts = (JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }).scripts;
const notChained = /;|\|\||&(?!&)/;

describe('package.json scripts', () => {
  // npm packs whatever dist holds and publishes it as package.json's version.
  describe('prepack', () => {
    it('checks the build before anything else, and goes on only when it passes', () => {
      const steps = scripts.prepack.split(' && ');
      expect(steps[0]).toBe('node scripts/check-build.mjs');
      for (const step of steps) expect(step).not.toMatch(notChained);
    });
  });

  // The stamp is only true if the build empties dist before anything else and stamps it after everything
  // else has succeeded: a failed step then leaves no dist, and never an earlier build's.
  describe('build', () => {
    const steps = scripts.build.split(' && ');

    it('empties dist first', () => {
      expect(steps[0]).toBe('rm -rf dist');
    });

    it('stamps dist last, and only once every step before has succeeded', () => {
      expect(steps.at(-1)).toBe('node scripts/stamp-build.mjs');
      for (const step of steps) expect(step).not.toMatch(notChained);
    });
  });
});
