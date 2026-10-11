import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

// A test that gets the name of a home variable wrong falls back to the default home. That default
// must be a throwaway folder, or the test writes into the running install.
describe('test isolation', () => {
  it('gives the tests a home that is not the real one', () => {
    expect(process.env.TEST_REAL_HOME).toBeTruthy();
    expect(homedir()).not.toBe(process.env.TEST_REAL_HOME);
    expect(process.env.WORKOFFDESK_HOME).toBeUndefined();
  });

  it('gives every process a test starts the same throwaway home', () => {
    expect(process.env.TEST_REAL_HOME).toBeTruthy();
    const child = execFileSync(process.execPath, ['-p', 'require("node:os").homedir()'], { encoding: 'utf8' }).trim();
    expect(child).toBe(homedir());
    expect(child).not.toBe(process.env.TEST_REAL_HOME);
  });

  it('keeps what a test file makes in a temporary folder of its own, the home too', () => {
    expect(basename(tmpdir())).toMatch(/^ts-run-/);
    expect(dirname(homedir())).toBe(tmpdir());
    const child = execFileSync(process.execPath, ['-p', 'require("node:os").tmpdir()'], { encoding: 'utf8' }).trim();
    expect(child).toBe(tmpdir());
  });

  it("leaves the config folders of this Mac's Claude Code and Codex out of every test", () => {
    expect(process.env.TEST_REAL_HOME).toBeTruthy();
    expect(process.env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(process.env.CODEX_HOME).toBeUndefined();
  });

  // A Codex a test starts would read as open in a session here, not in a terminal, when run from inside one.
  it.each(['WORKOFFDESK_SESSION', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'])(
    'starts no process marked as run inside another program (%s)',
    (name) => {
      expect(process.env.TEST_REAL_HOME).toBeTruthy();
      expect(process.env[name]).toBeUndefined();
      const child = execFileSync(process.execPath, ['-p', `process.env.${name} ?? ''`], { encoding: 'utf8' }).trim();
      expect(child).toBe('');
    },
  );

  // A session a test starts runs `claude` from PATH unless the test names one; the Claude Code installed here
  // would open the conversation it is given with the account signed in.
  it.each([
    ['a process a test starts', ['-c']],
    ['a login shell, as a session runs it', ['-lc']],
  ])('gives %s a claude that lists no one and runs nothing', (_, flags) => {
    expect(process.env.TEST_REAL_PATH).toBeTruthy();
    const found = execFileSync('/bin/sh', [...flags, 'command -v claude'], { encoding: 'utf8' }).trim();
    expect(found).not.toBe('');
    expect(found.startsWith(process.env.TEST_REAL_HOME!)).toBe(false);
    expect(execFileSync('/bin/sh', [...flags, 'claude agents --json'], { encoding: 'utf8' }).trim()).toBe('[]');
    expect(() => execFileSync('/bin/sh', [...flags, 'claude --resume 0b9c2a7e-1111-4222-8333-944445555666'], { stdio: 'ignore' })).toThrow();
  });
});
