import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppDeps } from '../../../../src/http/app.js';
import { recentClaude } from '../../../../src/http/routes/claude.js';

// Two conversations, each held by a session here, one whose Claude runs and one whose Claude ended; both open in a
// terminal on the Mac too.
const root = mkdtempSync(join(tmpdir(), 'ts-recent-'));
mkdirSync(join(root, '-proj'));
const RUNS = '0b9c2a7e-1111-4222-8333-944445555661';
const ENDED = '0b9c2a7e-1111-4222-8333-944445555662';
for (const sid of [RUNS, ENDED]) writeFileSync(join(root, '-proj', `${sid}.jsonl`), `${JSON.stringify({ type: 'user', cwd: '/Users/someone/proj', message: { content: 'hi' } })}\n`);
const onMac = { claudes: [{ pid: 1, sessionId: '', cwd: '', status: 'idle' as const, tty: null }], status: 'idle' as const };
const deps = {
  claudeProjectsRoot: root,
  machine: {
    listSessions: async () => [
      { id: 'runsHere', claudeSessionId: RUNS, status: 'idle' },
      { id: 'endedHere', claudeSessionId: ENDED, status: 'ended' },
    ],
    openOnMac: async () => new Map([[RUNS, onMac], [ENDED, onMac]]),
    claudeName: () => undefined,
    takingOver: () => false,
  },
} as unknown as AppDeps;

describe('recentClaude', () => {
  it('names as the session a conversation is open in only one whose Claude runs, so an ended one can be taken over from the Mac', async () => {
    const rows = await recentClaude(deps);
    expect(rows.find((r) => r.sessionId === RUNS)).toMatchObject({ openIn: 'runsHere' });
    expect(rows.find((r) => r.sessionId === ENDED)).toMatchObject({ openIn: null, onMac: { status: 'idle', terminals: 1 } });
  });
});
