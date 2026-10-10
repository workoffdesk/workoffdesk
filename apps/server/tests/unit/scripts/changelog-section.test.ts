import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(__dirname, '../../../scripts/changelog-section.mjs');
const CHANGELOG = ['# Changelog', '', '## 3.1.0', '', '- Newer things', '', '## 3.0.0', '', 'The first public release.', '', '### Added', '', '- A thing', ''].join('\n');

const section = (tag: string) => {
  const file = join(mkdtempSync(join(tmpdir(), 'changelog-')), 'CHANGELOG.md');
  writeFileSync(file, CHANGELOG);
  return spawnSync(process.execPath, [script, tag, file], { encoding: 'utf8' });
};

describe('scripts/changelog-section.mjs', () => {
  it('prints its version’s section of the changelog, without the heading, up to the next version', () => {
    const r = section('v3.0.0');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('The first public release.\n\n### Added\n\n- A thing\n');
  });

  it('takes the newest section when it is asked for', () => {
    expect(section('v3.1.0').stdout).toBe('- Newer things\n');
  });

  it('fails, naming the version, when the changelog has no section for it', () => {
    const r = section('v3.0.1');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('3.0.1');
  });
});
