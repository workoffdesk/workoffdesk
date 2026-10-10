import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialized } from '../../../../../src/agents/claude/offers/initialize.js';
import { alive } from '../../../../helpers/processes.js';

// Claude Code asked, as a program asks it, what its prompt takes before any turn. A shell script stands in
// for it: it notes how it was run in the folder it is run in, then says `out`.
const ANSWER = { commands: [{ name: 'compact', description: 'Clear history' }], models: [{ value: 'default' }] };
const q = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const said = (response: unknown) => JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'initialize', response } });

const claude = (out: string, o: { exit?: string } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'ts-claude-'));
  const bin = join(dir, 'claude');
  writeFileSync(
    bin,
    [
      '#!/bin/sh',
      'echo run >> runs',
      'printf "%s\\n" "$@" > argv',
      'echo $$ > pid',
      'head -n 1 > stdin',
      `printf '%s' ${q(out)}`,
      o.exit ?? 'exec sleep 30',
    ].join('\n'),
  );
  chmodSync(bin, 0o755);
  const cwd = mkdtempSync(join(tmpdir(), 'ts-project-'));
  const runs = () => (existsSync(join(cwd, 'runs')) ? readFileSync(join(cwd, 'runs'), 'utf8').split('\n').filter(Boolean).length : 0);
  const pid = () => Number(readFileSync(join(cwd, 'pid'), 'utf8'));
  return { bin, cwd, runs, pid, read: (f: string) => readFileSync(join(cwd, f), 'utf8') };
};

afterEach(() => vi.useRealTimers());

describe('initialized', () => {
  it('gives what claude answers to initialize, asked without hooks or a transcript, and leaves nothing running', async () => {
    const c = claude(`${said(ANSWER)}\n`);
    expect(await initialized(c.bin, c.cwd)).toEqual(ANSWER);
    expect(c.read('argv').trimEnd().split('\n')).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--settings', '{"disableAllHooks":true}']);
    expect(JSON.parse(c.read('stdin'))).toEqual({ type: 'control_request', request_id: 'initialize', request: { subtype: 'initialize' } });
    await vi.waitFor(() => expect(alive(c.pid())).toBe(false));
  });

  it('reads the answer past what else claude says first, and from a line that comes in pieces', async () => {
    const line = said(ANSWER);
    const c = claude(`not json\n{"type":"system"}\n${line.slice(0, 20)}`, { exit: `sleep 0.2; printf '%s\\n' ${q(line.slice(20))}; exec sleep 30` });
    expect(await initialized(c.bin, c.cwd)).toEqual(ANSWER);
  });

  it('keeps the answer a while for the same claude in the same folder, and asks again after', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const c = claude(`${said(ANSWER)}\n`);
    const first = initialized(c.bin, c.cwd);
    expect(initialized(c.bin, c.cwd)).toBe(first);
    await first;
    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(initialized(c.bin, c.cwd)).toBe(first);
    expect(c.runs()).toBe(1);
    vi.advanceTimersByTime(1);
    await initialized(c.bin, c.cwd);
    expect(c.runs()).toBe(2);
  });

  it('asks for each folder of its own', async () => {
    const c = claude(`${said(ANSWER)}\n`);
    const other = mkdtempSync(join(tmpdir(), 'ts-project-'));
    await initialized(c.bin, c.cwd);
    await initialized(c.bin, other);
    expect(c.runs()).toBe(1);
    expect(existsSync(join(other, 'runs'))).toBe(true);
  });

  it.each<[string, string, string, string]>([
    ['it ends without answering', '{"type":"system"}\n', 'exit 0', 'claude ended before answering initialize'],
    ['it answers with nothing', `${said(null)}\n`, 'exec sleep 30', 'claude answered initialize with nothing'],
    ['it answers with something that is not an answer', `${said('ok')}\n`, 'exec sleep 30', 'claude answered initialize with nothing'],
  ])('rejects when %s, and asks again next time', async (_, out, exit, error) => {
    const c = claude(out, { exit });
    await expect(initialized(c.bin, c.cwd)).rejects.toThrow(error);
    await expect(initialized(c.bin, c.cwd)).rejects.toThrow(error);
    expect(c.runs()).toBe(2);
  });

  it('rejects when there is no such claude', async () => {
    await expect(initialized(join(tmpdir(), 'no-such-claude'), tmpdir())).rejects.toThrow(/ENOENT/);
  });

  it('rejects when claude does not answer in time, and stops it', async () => {
    const c = claude('');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const answer = initialized(c.bin, c.cwd);
    const settled = answer.catch((e: Error) => e.message);
    await vi.waitFor(() => expect(existsSync(join(c.cwd, 'stdin'))).toBe(true), { interval: 20 });
    vi.advanceTimersByTime(15_000 - 1);
    expect(alive(c.pid())).toBe(true);
    vi.advanceTimersByTime(1);
    expect(await settled).toBe('claude did not answer initialize');
    vi.useRealTimers();
    await vi.waitFor(() => expect(alive(c.pid())).toBe(false));
  });
});
