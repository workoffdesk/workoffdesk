import { mkdtempSync, rmSync } from 'node:fs';
import { afterAll } from 'vitest';

// A folder for unix sockets, which are cut at 104 bytes: short, under /tmp, and gone once the file's tests are.
export function socketDir(name: string): string {
  const dir = mkdtempSync(`/tmp/wod-${name}-`);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
