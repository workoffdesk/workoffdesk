import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalMachine } from '../../../src/sessions/machine.js';
import { tmuxName } from '../../../src/sessions/sessionName.js';
import { machineSetup } from '../../helpers/machine.js';
import { until } from '../../helpers/until.js';

const { dir, tmux, make, restarted } = machineSetup('send');

describe('LocalMachine', () => {
  describe('sendMessage', () => {
    // Takes input raw with bracketed paste on, the way Claude Code does, and appends every byte it gets to a file.
    const READER = join(dir, 'reader.py');
    writeFileSync(
      READER,
      [
        'import os, sys, tty',
        'log = sys.argv[1]',
        'tty.setraw(0)',
        "os.write(1, b'\\x1b[?2004hreader-ready\\r\\n')",
        'while True:',
        "    with open(log, 'ab') as f: f.write(os.read(0, 4096))",
      ].join('\n'),
    );
    // The reader with a draft typed at a prompt like Claude Code's, which a Ctrl+S puts aside when `stashes`.
    const DRAFTED = join(dir, 'drafted.py');
    writeFileSync(
      DRAFTED,
      [
        'import os, sys, tty',
        'log, stashes = sys.argv[1], sys.argv[2] == "1"',
        'tty.setraw(0)',
        String.raw`rule = '\u2500' * 20`,
        String.raw`prompt = lambda typed: os.write(1, ('\x1b[2J\x1b[H\x1b[?2004hreader-ready\r\n' + rule + '\r\n\u276f\u00a0' + typed + '\r\n' + rule + '\r\n').encode())`,
        "prompt('a draft')",
        'while True:',
        '    got = os.read(0, 4096)',
        "    with open(log, 'ab') as f: f.write(got)",
        String.raw`    if stashes and b'\x13' in got: prompt('')`,
      ].join('\n'),
    );
    const reading = async (run = `${READER} ${dir}/got-$WORKOFFDESK_SESSION.log`) => {
      const { m, store } = make({ claudeArgs: ['--run', `exec python3 ${run}`] });
      const s = await m.createSession({ kind: 'claude', cwd: dir });
      const log = join(dir, `got-${s.id}.log`);
      writeFileSync(log, '');
      expect(await until(async () => (await m.screenText(s.id)).includes('reader-ready'))).toBe(true);
      // What SessionStart says of a real Claude: it is at its prompt, and what is sent goes in.
      m.setStatus(s.id, 'idle');
      return { m, store, id: s.id, got: () => readFileSync(log, 'latin1') };
    };
    const paste = (...texts: string[]) => texts.map((t) => `\x1b[200~${t}\x1b[201~\r`).join('');
    // The messages waiting for Claude as the journal has them for the page, in the order they go.
    const waiting = (machine: LocalMachine, id: string) =>
      machine.journal
        .messages(id)
        .filter((q) => q.state === 'queued')
        .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0))
        .map((q) => q.text);

    it('sends them as a paste and an Enter, with no control bytes of their own', async () => {
      const { m, id, got } = await reading();
      expect(await m.sendMessage(id, 'line a\nline b')).toBeNull();
      expect(await until(() => got() === paste('line a\nline b'))).toBe(true);
      m.setStatus(id, 'idle');
      expect(await m.sendMessage(id, 'x\x1b[201~\x03y')).toBeNull();
      expect(await until(() => got() === paste('line a\nline b', 'x[201~y'))).toBe(true);
    });

    describe('with something already typed at the prompt', () => {
      const drafted = (stashes: boolean) => reading(`${DRAFTED} ${dir}/got-$WORKOFFDESK_SESSION.log ${stashes ? 1 : 0}`);

      it('puts it aside before the message goes, so the two are not sent as one', async () => {
        const { m, id, got } = await drafted(true);
        expect(await m.sendMessage(id, 'hi')).toBeNull();
        expect(await until(() => got() === `\x13${paste('hi')}`)).toBe(true);
      });

      it('holds the message when it will not go aside', async () => {
        const { m, id, got } = await drafted(false);
        expect(await m.sendMessage(id, 'hi')).toMatchObject({ text: 'hi' });
        expect(got()).toBe('\x13');
        expect(waiting(m, id)).toEqual(['hi']);
      });

      it.each([
        [true, { ran: true, typed: '\x13/effort high\r' }],
        [false, { ran: false, typed: '\x13' }],
      ])('types a command after it only once it went aside (it goes aside: %s)', async (stashes, after) => {
        const { m, id, got } = await drafted(stashes);
        const { ran } = await m.runCommand(id, '/effort high');
        expect(await until(() => got() === after.typed)).toBe(true);
        expect(ran).toBe(after.ran);
      });
    });

    it("sends a second one while Claude works at once, into Claude's own queue", async () => {
      const { m, id, got } = await reading();
      expect(await m.sendMessage(id, 'first')).toBeNull();
      expect(await until(() => got() === paste('first'))).toBe(true);
      // What UserPromptSubmit says once Claude has the first.
      m.setStatus(id, 'working');
      expect(await m.sendMessage(id, 'second')).toBeNull();
      expect(await until(() => got() === paste('first', 'second'))).toBe(true);
      expect(m.journal.messages(id).map((q) => [q.text, q.state])).toEqual([
        ['first', 'delivered'],
        ['second', 'enqueued'],
      ]);
    });

    // Each send reads the screen first; the first read here is the slow one.
    it('queues ones sent one after another without waiting, in the order they were sent', async () => {
      const { m, id } = await reading();
      m.compactStarted(id);
      const read = tmux.screenAndAbove.bind(tmux);
      let reads = 0;
      tmux.screenAndAbove = async (...args) => {
        if (reads++ === 0) await new Promise((r) => setTimeout(r, 300));
        return read(...args);
      };
      try {
        await Promise.all(['one', 'two', 'three'].map((t) => m.sendMessage(id, t)));
      } finally {
        tmux.screenAndAbove = read;
      }
      expect(waiting(m, id)).toEqual(['one', 'two', 'three']);
    });

    it('holds them while Claude compacts, through a restart, and then sends them in the order they were sent', async () => {
      const { m, store, id, got } = await reading();
      m.compactStarted(id);
      expect(await m.sendMessage(id, 'one')).toMatchObject({ text: 'one' });
      await m.sendMessage(id, 'two');
      expect(waiting(m, id)).toEqual(['one', 'two']);
      await new Promise((r) => setTimeout(r, 500));
      expect(got()).toBe('');

      const again = restarted(store);
      again.compactStarted(id);
      expect(waiting(again, id)).toEqual(['one', 'two']);
      // The program has the text before tmux returns; a slow tmux shows it.
      const pasteNow = tmux.paste.bind(tmux);
      tmux.paste = async (...args) => {
        await pasteNow(...args);
        await new Promise((r) => setTimeout(r, 300));
      };
      try {
        again.compactEnded(id, false);
        expect(await until(() => got() === paste('one'))).toBe(true);
        // Claude takes one message a turn: the next goes in once it stops, which it does only after it has the first.
        expect(await until(() => again.getStatus(id) === 'working')).toBe(true);
        again.setStatus(id, 'idle');
        expect(await until(() => got() === paste('one', 'two'))).toBe(true);
      } finally {
        tmux.paste = pasteNow;
      }
      expect(await until(() => waiting(again, id).length === 0)).toBe(true);
    });

    it('notes one that goes in at once in the journal as delivered, not waiting, through a restart', async () => {
      const { m, store, id, got } = await reading();
      expect(await m.sendMessage(id, 'meanwhile')).toBeNull();
      expect(await until(() => got() === paste('meanwhile'))).toBe(true);
      const went = (machine: LocalMachine) => machine.journal.messages(id).map((q) => ({ text: q.text, state: q.state }));
      expect(await until(() => went(m)[0]?.state === 'delivered')).toBe(true);
      expect(went(m)).toEqual([{ text: 'meanwhile', state: 'delivered' }]);
      const again = restarted(store);
      expect(went(again)).toEqual([{ text: 'meanwhile', state: 'delivered' }]);
      expect(waiting(again, id)).toEqual([]);
    });

    it('lets a held message be taken back before it goes', async () => {
      const { m, id, got } = await reading();
      m.compactStarted(id);
      const q = (await m.sendMessage(id, 'never'))!;
      await m.sendMessage(id, 'kept');
      expect(m.unsend(id, q.id)).toBe('never');
      m.compactEnded(id, false);
      expect(await until(() => got() === paste('kept')), JSON.stringify(got())).toBe(true);
    });
  });

  describe('toBackground', () => {
    // A tool at work drawn as Claude Code draws it, with its offer to go to the background until a while after a
    // Ctrl+B comes; every byte it gets goes to a file.
    const OFFERING = join(dir, 'offering.py');
    writeFileSync(
      OFFERING,
      [
        'import os, sys, time, tty',
        'log = sys.argv[1]',
        'tty.setraw(0)',
        String.raw`draw = lambda offer: os.write(1, ('\x1b[2J\x1b[Hoffering-ready\r\n  Bash(sleep 600)\r\n  ⎿  Running… (5s)\r\n' + ('     (ctrl+b ctrl+b (twice) to run in background)\r\n' if offer else '')).encode())`,
        'draw(True)',
        'while True:',
        '    got = os.read(0, 4096)',
        "    with open(log, 'ab') as f: f.write(got)",
        String.raw`    if b'\x02' in got: time.sleep(0.3); draw(False)`,
      ].join('\n'),
    );

    it('presses one Ctrl+B, which reaches Claude past the prefix of tmux, and no second once the offer is gone', async () => {
      const { m } = make({ claudeArgs: ['--run', `exec python3 ${OFFERING} ${dir}/bg-$WORKOFFDESK_SESSION.log`] });
      const { id } = await m.createSession({ kind: 'claude', cwd: dir });
      const log = join(dir, `bg-${id}.log`);
      writeFileSync(log, '');
      expect(await until(async () => (await m.screenText(id)).includes('to run in background'))).toBe(true);
      m.setStatus(id, 'working');
      expect(await m.toBackground(id)).toBe(true);
      expect(readFileSync(log, 'latin1')).toBe('\x02');
      expect(await m.toBackground(id)).toBe(false);
      expect(readFileSync(log, 'latin1')).toBe('\x02');
    });

    it('presses nothing in a shell, whatever its screen says', async () => {
      const { m } = make();
      const { id } = await m.createSession({ kind: 'shell', cwd: dir });
      const log = join(dir, `bg-${id}.log`);
      writeFileSync(log, '');
      await tmux.sendKeys(tmuxName(id), `exec python3 ${OFFERING} ${log}`);
      expect(await until(async () => (await m.screenText(id)).includes('to run in background'))).toBe(true);
      expect(await m.toBackground(id)).toBe(false);
      expect(readFileSync(log, 'latin1')).toBe('');
    });
  });
});
