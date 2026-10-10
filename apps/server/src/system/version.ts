import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The package this file is part of, found by walking up, as in the source and in a build it sits at a different depth.
function readVersion(): string {
  for (let dir = dirname(fileURLToPath(import.meta.url)); dir !== dirname(dir); dir = dirname(dir)) {
    const file = join(dir, 'package.json');
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
    if (pkg.name === 'workoffdesk') return pkg.version ?? '0.0.0';
  }
  return '0.0.0';
}

export const VERSION = readVersion();
