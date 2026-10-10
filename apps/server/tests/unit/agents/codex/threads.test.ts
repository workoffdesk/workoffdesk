import { mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { holderOf, rolloutEnd } from '../../../../src/agents/codex/threads.js';

// Lines as `ps -E -ww -o command=` gives them: the command, then the environment it was started with.
const SOCK = '/Users/someone/.workoffdesk/codex.sock';
const CODEX = '/Users/someone/.local/lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/bin/codex';
const at = (command: string, tty = 'ttys003') => holderOf({ pid: 4242, tty, since: 1_000, command }, SOCK);

describe('holderOf', () => {
  it("returns this server, when it is this server's app server", () => {
    expect(at(`${CODEX} app-server --listen unix://${SOCK} HOME=/Users/someone`, '??')).toEqual({ at: 'here' });
  });

  it('returns this server also when the two name its socket through /var and /private/var', () => {
    const sock = join(mkdtempSync(join(tmpdir(), 'ts-sock-')), 'codex.sock');
    writeFileSync(sock, '');
    const other = sock.startsWith('/private/') ? sock.slice('/private'.length) : realpathSync(sock);
    expect(other).not.toBe(sock);
    expect(holderOf({ pid: 1, tty: '??', since: 0, command: `${CODEX} app-server --listen unix://${other}` }, sock)).toEqual({ at: 'here' });
  });

  it.each([
    ["an editor's or the desktop app's app server", `${CODEX} app-server`],
    ['an app server listening on another socket', `${CODEX} app-server --listen unix:///Users/someone/other.sock`],
    ['a Codex in a WorkOffDesk session', `${CODEX} resume 0199 TERM=xterm-256color WORKOFFDESK_SESSION=abcd1234 SHELL=/bin/zsh`],
    ['codex exec, through the npm wrapper', `node /usr/local/bin/codex exec "fix the tests"`],
    ['codex exec, by its path', `/opt/homebrew/bin/codex exec resume 0199 "go on"`],
    ['codex exec, by its name alone', `codex exec resume 0199 "go on" PATH=/opt/homebrew/bin`],
  ])('returns elsewhere, never stopped from here, for %s', (_, command) => {
    expect(at(command)).toEqual({ at: 'elsewhere' });
  });

  it('returns a terminal, with its process, tty and start, for a Codex someone runs in a terminal', () => {
    expect(at(`${CODEX} resume 0199 TERM=xterm-256color SHELL=/bin/zsh`)).toEqual({ at: 'terminal', pid: 4242, tty: 'ttys003', since: 1_000 });
  });

  it.each([
    ['an empty WORKOFFDESK_SESSION', `${CODEX} WORKOFFDESK_SESSION= TERM=xterm`],
    ['a variable that only ends in WORKOFFDESK_SESSION', `${CODEX} OLD_WORKOFFDESK_SESSION=abcd TERM=xterm`],
    ['a folder named like the app server', `${CODEX} -C /Users/someone/app-server-notes`],
  ])('returns a terminal, not fooled by %s', (_, command) => {
    expect(at(command)).toMatchObject({ at: 'terminal' });
  });

  it('has no tty for a process without one', () => {
    expect(at(`${CODEX} resume 0199`, '??')).toMatchObject({ at: 'terminal', tty: null });
  });
});

describe('rolloutEnd', () => {
  const T0 = Date.parse('2026-10-08T04:00:00.000Z');
  const event = (payload: object, ms = T0) => JSON.stringify({ timestamp: new Date(ms).toISOString(), type: 'event_msg', payload });
  const started = (ms = T0) => event({ type: 'task_started', turn_id: 't' }, ms);
  const complete = event({ type: 'task_complete', turn_id: 't' });
  const aborted = event({ type: 'turn_aborted', turn_id: 't', reason: 'interrupted' });
  const said = (...content: object[]) => event({ type: 'item_completed', thread_id: 'x', turn_id: 't', item: { type: 'UserMessage', id: 'u', content } });
  const text = (t: string) => ({ type: 'text', text: t, text_elements: [] });
  const ended = async (...lines: string[]) => {
    const f = join(mkdtempSync(join(tmpdir(), 'ts-rollout-')), 'rollout.jsonl');
    writeFileSync(f, lines.map((l) => `${l}\n`).join(''));
    return rolloutEnd(f);
  };

  it('tells it is not at work before a turn starts', async () => {
    expect(await ended(JSON.stringify({ type: 'session_meta', payload: {} }))).toMatchObject({ busy: false, turnAt: 0, lastPrompt: null });
  });

  it('tells it is at work from a turn starting, since then', async () => {
    expect(await ended(started(T0 + 5_000))).toMatchObject({ busy: true, turnAt: T0 + 5_000 });
  });

  it.each([
    ['done', complete],
    ['stopped', aborted],
  ])('tells it is not at work once the turn is %s', async (_, end) => {
    expect((await ended(started(), end)).busy).toBe(false);
  });

  it('tells it is at work again in the next turn, since that one started', async () => {
    expect(await ended(started(T0), complete, started(T0 + 60_000))).toMatchObject({ busy: true, turnAt: T0 + 60_000 });
  });

  it('says what the person said last, in their words on one line, cut at 200 characters', async () => {
    expect((await ended(said(text('first')), said(text('second')))).lastPrompt).toBe('second');
    expect((await ended(said({ type: 'image', image_url: 'data:' }, text('what is'), text('  this?\n')))).lastPrompt).toBe('what is this?');
    expect((await ended(said(text('x'.repeat(300))))).lastPrompt).toBe('x'.repeat(200));
    expect((await ended(said(text('🐦'.repeat(300))))).lastPrompt).toBe('🐦'.repeat(200));
  });

  it('does not take a message with no words in it for what the person said', async () => {
    expect((await ended(said(text('the question')), said({ type: 'image', image_url: 'data:' }))).lastPrompt).toBe('the question');
  });

  // Codex before September wrote what the person said as an event of its own.
  it('says what the person said last in a rollout an older Codex wrote', async () => {
    expect((await ended(event({ type: 'user_message', message: '  older\n words ', images: [] }))).lastPrompt).toBe('older words');
  });

  it('reads past lines that are not its events, or not JSON', async () => {
    const lines = [started(), '{"type":"response_item","payload":{"type":"message","content":"\\"event_msg\\" task_complete"}}', '{"type":"event_msg",', 'not json'];
    expect((await ended(...lines)).busy).toBe(true);
  });

  it('says when it was written last', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'ts-rollout-')), 'rollout.jsonl');
    writeFileSync(f, `${started()}\n`);
    utimesSync(f, 1_700_000_000, 1_700_000_000);
    expect((await rolloutEnd(f)).mtime).toBe(1_700_000_000_000);
  });

  describe('with a rollout too long to read whole', () => {
    const TAIL = 64 * 1024;
    const filler = event({ type: 'token_count', info: { note: 'y'.repeat(1_000) } });
    const long = Array(200).fill(filler);

    it('reads its end', async () => {
      expect(await ended(said(text('at the start')), started(), ...long, complete, said(text('at the end')))).toMatchObject({ busy: false, lastPrompt: 'at the end' });
      expect((await ended(started(), ...long, complete, ...long, started(T0 + 1)))).toMatchObject({ busy: true, turnAt: T0 + 1 });
    });

    // The part read starts on a line of its own (0), or in the one before it, which is cut and dropped.
    it.each([0, 1, 7])('reads a turn whose line starts %i bytes into the part read', async (into) => {
      const start = started(T0 + 9);
      const pad = (n: number) => event({ type: 'token_count', info: { note: 'z'.repeat(n) } });
      const after = pad(TAIL - into - (start.length + 1) - 1 - pad(0).length);
      expect(start.length + 1 + after.length + 1).toBe(TAIL - into);
      expect(await ended(...long, start, after)).toMatchObject({ busy: true, turnAt: T0 + 9 });
    });
  });
});
