import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as { publishConfig?: Record<string, string> };

describe('publishing', () => {
  // A machine set to a mirror for installs still publishes to npm, and the package is public without --access.
  it('goes to the public npm registry, as a public package', () => {
    expect(pkg.publishConfig).toEqual({ registry: 'https://registry.npmjs.org/', access: 'public' });
  });
});
