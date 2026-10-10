import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveClaude } from '../../../src/http/serve.js';

describe('resolveClaude', () => {
  const exe = (dir: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'claude'), '#!/bin/sh\n');
    chmodSync(join(dir, 'claude'), 0o755);
    return join(dir, 'claude');
  };

  it('prefers ~/.local/bin and never picks a node_modules shim', () => {
    const root = mkdtempSync(join(tmpdir(), 'ts-claude-'));
    const shim = exe(join(root, 'node_modules/.bin'));
    const brew = exe(join(root, 'brew'));
    const local = exe(join(root, 'home/.local/bin'));
    expect(resolveClaude({ PATH: [join(root, 'node_modules/.bin'), join(root, 'brew')].join(':') }, join(root, 'home'))).toBe(local);
    rmSync(local);
    expect(resolveClaude({ PATH: [join(root, 'node_modules/.bin'), join(root, 'brew')].join(':') }, join(root, 'home'))).toBe(brew);
    expect(shim).toContain('node_modules');
  });
});
