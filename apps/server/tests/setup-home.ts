import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// What a test file makes in the temporary folder goes with it: TMPDIR, which os.tmpdir() reads, is a folder
// of the file's own, removed once its tests are.
const tmp = mkdtempSync(join(tmpdir(), 'ts-run-'));
process.env.TMPDIR = tmp;
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));

// Every test, and every process a test starts, gets a home of its own. A test that names a home
// variable wrongly then lands in a throwaway folder instead of the running install's data.
// TEST_REAL_HOME is there for the tests that read real transcripts, and only read them.
process.env.TEST_REAL_HOME ??= process.env.HOME;
process.env.HOME = mkdtempSync(join(tmpdir(), 'ts-home-'));
delete process.env.WORKOFFDESK_HOME;
// Nor do they reach the Claude Code and Codex of this Mac: not their config folders, which a Claude running the
// tests passes down, and not the claude on PATH, which a session a test starts runs unless the test names one.
// It lists no one open, and runs nothing. TEST_REAL_PATH finds the real one, for the test that asks for it.
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;
// Nor are they marked as run inside a session here or a Claude, as they are when one runs them: a process a
// test starts would carry the mark, and read as open in a session, not in the terminal the test means.
delete process.env.WORKOFFDESK_SESSION;
delete process.env.CLAUDECODE;
delete process.env.CLAUDE_CODE_ENTRYPOINT;
process.env.TEST_REAL_PATH ??= process.env.PATH;
const bin = mkdtempSync(join(tmpdir(), 'ts-bin-'));
writeFileSync(join(bin, 'claude'), `#!/bin/sh\n[ "$1 $2" = "agents --json" ] && exec echo '[]'\necho "tests run no Claude Code: claude $*" >&2\nexit 127\n`);
chmodSync(join(bin, 'claude'), 0o755);
process.env.PATH = `${bin}:${process.env.TEST_REAL_PATH}`;
