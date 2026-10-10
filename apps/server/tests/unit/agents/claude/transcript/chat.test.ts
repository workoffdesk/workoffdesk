import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatItems } from '../../../../../src/agents/claude/transcript/chat.js';
import { writeClaudeSettings } from '../../../../../src/agents/claude/hooks/hooks.js';
import { readChatBefore } from '../../../../../src/agents/claude/transcript/transcriptFile.js';

// Shapes copied from real Claude Code transcripts, trimmed to the fields that matter.
const at = '2026-10-03T06:00:00.000Z';
const user = (content: unknown, extra = {}) => ({ type: 'user', timestamp: at, message: { role: 'user', content }, ...extra });
const assistant = (block: unknown, extra = {}) => ({ type: 'assistant', timestamp: at, message: { role: 'assistant', content: [block] }, ...extra });
const scratch = () => mkdtempSync(join(tmpdir(), 'ts-chat-'));

describe('chatItems', () => {
  it.each([
    ['a prompt typed by the user', user('把按钮改成圆角'), [{ k: 'user', text: '把按钮改成圆角', at }]],
    ['a prompt with a picture', user([{ type: 'text', text: '看这张' }, { type: 'image', source: {} }]), [{ k: 'user', text: '看这张 [image]', at }]],
    ['what Claude says', assistant({ type: 'text', text: '改好了。' }), [{ k: 'text', text: '改好了。', at }]],
    [
      'a shell command, by its description',
      assistant({ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test', description: '跑测试' } }),
      [{ k: 'tool', id: 't1', name: 'Bash', summary: '跑测试', at }],
    ],
    ['a file edit, by its file', assistant({ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/a/b.ts', old_string: 'x' } }), [{ k: 'tool', id: 't2', name: 'Edit', summary: '/a/b.ts', at }]],
    ['a search, by its pattern', assistant({ type: 'tool_use', id: 't3', name: 'Grep', input: { pattern: 'TODO' } }), [{ k: 'tool', id: 't3', name: 'Grep', summary: 'TODO', at }]],
    ['an unknown tool, by its first text input', assistant({ type: 'tool_use', id: 't4', name: 'mcp__x__y', input: { n: 3, q: '查一下' } }), [{ k: 'tool', id: 't4', name: 'mcp__x__y', summary: '查一下', at }]],
    [
      'a tool result',
      user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok\n3 passed' }]),
      [{ k: 'result', id: 't1', text: 'ok\n3 passed', error: false }],
    ],
    [
      'an image the Read tool read, which the chat shows from the file',
      user([{ type: 'tool_result', tool_use_id: 't5', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }] }]),
      [{ k: 'result', id: 't5', text: '[image]', error: false, image: true }],
    ],
    [
      'a failed tool result given as blocks',
      user([{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'boom' }] }]),
      [{ k: 'result', id: 't1', text: 'boom', error: true }],
    ],
    ['a slash command', user('<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>'), [{ k: 'note', text: '/clear', command: true, at }]],
    ['what a slash command printed', user('<local-command-stdout>Compacted</local-command-stdout>'), [{ k: 'note', text: 'Compacted' }]],
    // As Claude Code 2.1.215 to 2.1.295 record a command typed after `!`, and what it printed.
    ['a shell command typed at the prompt', user('<bash-input>git log -1 &gt; out.txt</bash-input>'), [{ k: 'note', text: '!git log -1 > out.txt', command: true, at }]],
    ['what a shell command printed', user('<bash-stdout>/Users/me/proj</bash-stdout><bash-stderr></bash-stderr>'), [{ k: 'note', text: '/Users/me/proj' }]],
    ['what a shell command printed, then its errors', user('<bash-stdout>a -&gt; b</bash-stdout><bash-stderr>warning: x\n</bash-stderr>'), [{ k: 'note', text: 'a -> b\nwarning: x' }]],
    ['what a failed shell command printed', user("<bash-stdout></bash-stdout><bash-stderr>bash: syntax error near unexpected token `)'\n</bash-stderr>"), [{ k: 'note', text: "bash: syntax error near unexpected token `)'" }]],
    ['nothing of a shell command that printed nothing', user('<bash-stdout></bash-stdout><bash-stderr></bash-stderr>'), []],
    ['an interruption', user([{ type: 'text', text: '[Request interrupted by user]' }]), [{ k: 'note', event: { e: 'interrupted' }, retry: true }]],
    ['the summary that replaces compacted history', user('This session is being continued…', { isCompactSummary: true }), [{ k: 'note', event: { e: 'compacted' } }]],
    [
      'a reply the API failed to give',
      assistant({ type: 'text', text: 'API Error: 529 Overloaded' }, { isApiErrorMessage: true }),
      [{ k: 'note', event: { e: 'failed' }, detail: '529 Overloaded', retry: true }],
    ],
    // As Claude Code 2.1.295 records an account's limit hit.
    [
      "a reply the account's usage limit stopped",
      assistant({ type: 'text', text: "You've hit your weekly limit · resets 4pm (Europe/Rome)" }, { isApiErrorMessage: true, error: 'rate_limit', apiError: 'usage_limit_reached' }),
      [{ k: 'note', event: { e: 'failed', limit: true }, detail: "You've hit your weekly limit · resets 4pm (Europe/Rome)", retry: true }],
    ],
  ])('shows %s', (_, record, items) => {
    expect(chatItems(record)).toEqual(items);
  });

  // From the real /compact of 2026-10-04: Claude Code writes hook lines into the transcript dimmed.
  it.each([
    ['what a slash command printed', user('<local-command-stdout>\u001b[2mCompacted (ctrl+o to see full summary)\u001b[22m\n\u001b[2mPreCompact [curl] completed successfully\u001b[22m</local-command-stdout>'), 'Compacted (ctrl+o to see full summary)\nPreCompact [curl] completed successfully'],
    ['a tool result', user([{ type: 'tool_result', tool_use_id: 't1', content: '\u001b[32m✓\u001b[0m 3 passed \u001b]8;;https://x.dev\u0007link\u001b]8;;\u0007' }]), '✓ 3 passed link'],
  ])('shows %s without terminal styling codes', (_, record, text) => {
    expect(chatItems(record).map((i) => ('text' in i ? i.text : ''))).toEqual([text]);
  });

  // The command workoffdesk itself installs as every hook, as Claude Code is given it, for a home of any path.
  const ownHook = (sock: string) => {
    const file = join(scratch(), 'settings.json');
    writeClaudeSettings(file, sock);
    return (JSON.parse(readFileSync(file, 'utf8')) as { hooks: Record<string, [{ hooks: [{ command: string }] }]> }).hooks.PreCompact[0].hooks[0].command;
  };
  const printed = (lines: string[]) => user(`<local-command-stdout>${lines.join('\n')}</local-command-stdout>`);

  it('leaves out what its own hooks printed after a command, for a home anywhere', () => {
    for (const sock of ['/tmp/osrt-tWkZ/hooks.sock', "/Users/a b/it's/.workoffdesk/hooks.sock"]) {
      const record = printed([
        '\u001b[2mCompacted (ctrl+o to see full summary)\u001b[22m',
        `\u001b[2mPreCompact [${ownHook(sock)}] completed successfully\u001b[22m`,
        `\u001b[2mPostCompact [${ownHook(sock)}] completed successfully\u001b[22m`,
      ]);
      expect(chatItems(record)).toEqual([{ k: 'note', text: 'Compacted (ctrl+o to see full summary)' }]);
    }
  });

  it('shows what hooks that are not its own printed', () => {
    const own = ownHook('/tmp/h/hooks.sock');
    const others = [
      'PreCompact [~/bin/notify.sh] completed successfully',
      // Not the command workoffdesk installs, though it talks to the same socket.
      `PreCompact [${own.replace('--max-time 2', '--max-time 9')}] completed successfully`,
      `PreCompact [${own} ; rm -rf ~/x] completed successfully`,
      `PreCompact [${own.replace(/ \|\| true$/, ' ; rm ~x')}] completed successfully`,
      `PreCompact [${own.replace("'/tmp/h/hooks.sock'", "'/tmp/h' $(touch ~/x) '/hooks.sock'")}] completed successfully`,
      `PreCompact [${own}] failed with exit code 7`,
    ];
    for (const line of others) expect(chatItems(printed(['Compacted', line]))).toEqual([{ k: 'note', text: `Compacted\n${line}` }]);
  });

  it('leaves out a stdout made only of its own hooks', () => {
    expect(chatItems(printed([`SessionStart [${ownHook('/tmp/h/hooks.sock')}] completed successfully`]))).toEqual([]);
  });

  // Claude Code records a typed /compact as the prompt it was, and again as a command after the summary.
  it('shows a /compact once, as the prompt that was typed', () => {
    expect(chatItems(user('/compact'))).toEqual([{ k: 'user', text: '/compact', at }]);
    expect(chatItems(user('<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>'))).toEqual([]);
    expect(chatItems(user('<command-name>/compact</command-name>\n<command-args>keep the API notes</command-args>'))).toEqual([]);
  });

  // Shapes from real transcripts (Claude Code 2.1.287–289): a message sent while Claude works that Claude
  // takes in the middle of its turn is recorded only as this attachment, never as a prompt.
  const absorbed = (prompt: unknown, extra = {}) => ({
    type: 'attachment',
    timestamp: at,
    attachment: { type: 'queued_command', prompt, commandMode: 'prompt', timestamp: at, ...extra },
  });
  it.each([
    ['a message Claude took in the middle of its turn', absorbed('找线下门店这个你别提了', { origin: { kind: 'human' } }), [{ k: 'user', text: '找线下门店这个你别提了', at }]],
    ['one recorded by an older version, which names no sender', absorbed('729'), [{ k: 'user', text: '729', at }]],
    ['one with a picture', absorbed([{ type: 'text', text: '看这张' }, { type: 'image', source: {} }]), [{ k: 'user', text: '看这张 [image]', at }]],
  ])('shows %s', (_, record, items) => {
    expect(chatItems(record)).toEqual(items);
  });

  it.each([
    ['a background task finishing', absorbed('<task-notification>x</task-notification>', { commandMode: 'task-notification' })],
    ['another session\'s message', absorbed('<cross-session-message>x</cross-session-message>', { origin: { kind: 'peer' } })],
    ['text for Claude only', absorbed('x', { isMeta: true })],
    ['another kind of attachment', { type: 'attachment', timestamp: at, attachment: { type: 'date', date: '2026-10-04' } }],
  ])('leaves out %s taken in the middle of a turn', (_, record) => {
    expect(chatItems(record)).toEqual([]);
  });

  // Shapes from real transcripts (Claude Code 2.1.287–289): what a file tool changed, as Claude Code worked it
  // out, rides on the record of its result.
  const changed = (toolUseResult: unknown, extra: object = {}) =>
    user([{ type: 'tool_result', tool_use_id: 'e1', content: 'The file /a/b.ts has been updated successfully.', ...extra }], { toolUseResult });
  const hunk = { oldStart: 194, oldLines: 3, newStart: 194, newLines: 4, lines: ['   keep', '-old line', '+new line', '+added line', '   keep too'] };

  it('carries what an edit changed, line by line, and how many lines went and came', () => {
    const [r] = chatItems(changed({ filePath: '/a/b.ts', oldString: 'old line', newString: 'new line', structuredPatch: [hunk], originalFile: null }));
    expect(r).toMatchObject({
      k: 'result',
      id: 'e1',
      error: false,
      diff: { file: '/a/b.ts', added: 2, removed: 1, hunks: [{ oldStart: 194, newStart: 194, lines: hunk.lines }] },
    });
  });

  it('carries a new file as all added', () => {
    const [r] = chatItems(changed({ type: 'create', filePath: '/a/new.md', content: '# 标题\n\n正文\n', structuredPatch: [], originalFile: null }));
    expect(r).toMatchObject({ diff: { file: '/a/new.md', created: true, added: 3, removed: 0, hunks: [{ oldStart: 0, newStart: 1, lines: ['+# 标题', '+', '+正文'] }] } });
  });

  it('carries a whole file written over the same way as an edit', () => {
    const [r] = chatItems(changed({ type: 'update', filePath: '/a/b.ts', content: 'x', structuredPatch: [hunk], originalFile: 'y' }));
    expect(r).toMatchObject({ diff: { file: '/a/b.ts', added: 2, removed: 1 } });
    expect((r as { diff: { created?: true } }).diff.created).toBeUndefined();
  });

  it('counts every changed line but keeps only the first few hundred, each cut short', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => (i % 2 ? `+${'y'.repeat(2000)}` : `-${i}`));
    const [r] = chatItems(changed({ filePath: '/a/b.ts', structuredPatch: [{ ...hunk, lines }] }));
    const d = (r as { diff: { added: number; removed: number; cut?: true; hunks: { lines: string[] }[] } }).diff;
    expect(d).toMatchObject({ added: 500, removed: 500, cut: true });
    const kept = d.hunks.flatMap((h) => h.lines);
    expect(kept.length).toBeLessThan(lines.length);
    expect(Math.max(...kept.map((l) => l.length))).toBeLessThan(600);
  });

  it.each([
    ['a failed edit', changed({ filePath: '/a/b.ts', structuredPatch: [hunk] }, { is_error: true })],
    ['an edit Claude Code recorded nothing changed for', changed({ filePath: '/a/b.ts', structuredPatch: [] })],
    ['a result that is not a file tool\'s', changed({ stdout: 'ok', stderr: '' })],
    ['a result whose record says nothing more', user([{ type: 'tool_result', tool_use_id: 'e1', content: 'ok' }])],
    ['a patch in a shape unheard of', changed({ filePath: '/a/b.ts', structuredPatch: [{ lines: 'not a list' }, 5] })],
    ['a patch whose lines are not all text', changed({ filePath: '/a/b.ts', structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['+a', 5] }] })],
    [
      'two results in one record, which one the change belongs to unknown',
      user(
        [
          { type: 'tool_result', tool_use_id: 'e1', content: 'ok' },
          { type: 'tool_result', tool_use_id: 'e2', content: 'ok' },
        ],
        { toolUseResult: { filePath: '/a/b.ts', structuredPatch: [hunk] } },
      ),
    ],
  ])('carries no change for %s', (_, record) => {
    for (const r of chatItems(record)) expect(r).not.toHaveProperty('diff');
  });

  // Shapes from a real transcript (Claude Code 2.1.288): the task list Claude keeps as it works.
  it.each([
    [
      'a task made, named in its result',
      { ...user([{ type: 'tool_result', tool_use_id: 'c1', content: 'Task #1 created' }]), toolUseResult: { task: { id: '1', subject: '去微信化' } } },
      [{ k: 'result', id: 'c1', text: 'Task #1 created', error: false }, { k: 'task', id: '1', subject: '去微信化', status: 'pending' }],
    ],
    [
      'a task changed',
      assistant({ type: 'tool_use', id: 'u1', name: 'TaskUpdate', input: { taskId: '1', status: 'in_progress' } }),
      [{ k: 'tool', id: 'u1', name: 'TaskUpdate', summary: '1', at }, { k: 'task', id: '1', status: 'in_progress' }],
    ],
    [
      'a whole list written at once',
      assistant({ type: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [{ content: '写测试', status: 'completed', activeForm: '' }, { bad: 1 }] } }),
      [{ k: 'tool', id: 't1', name: 'TodoWrite', summary: '', at }, { k: 'todos', items: [{ subject: '写测试', status: 'completed' }] }],
    ],
  ])('follows the task list: %s', (_, record, items) => {
    expect(chatItems(record)).toEqual(items);
  });

  it.each([
    ['Claude thinking', assistant({ type: 'thinking', thinking: '…' })],
    ['text injected for Claude only', user('<system-reminder>x</system-reminder>', { isMeta: true })],
    ['a subagent at work', assistant({ type: 'text', text: 'sub' }, { isSidechain: true })],
    ['bookkeeping', { type: 'attachment', attachment: { type: 'date' } }],
    ['a title', { type: 'ai-title', aiTitle: 'x' }],
    ['an empty reply', assistant({ type: 'text', text: '  ' })],
    ['something unheard of', { type: 'user', message: 42 }],
  ])('leaves out %s', (_, record) => {
    expect(chatItems(record)).toEqual([]);
  });

  // Who sent a prompt is in the record (Claude Code 2.1.287 and later); its text says nothing about it.
  describe('who a prompt came from', () => {
    const notification =
      '<task-notification>\n<task-id>bdfoi2os0</task-id>\n<tool-use-id>toolu_01Rm</tool-use-id>\n<output-file>/private/tmp/x/tasks/bdfoi2os0.output</output-file>\n<status>completed</status>\n<summary>Background command "Wait in background for MEM-727 to finish" completed (exit code 0)</summary>\n</task-notification>';
    const fromTask = { origin: { kind: 'task-notification', producer: 'session-task' }, promptSource: 'system', turnOrigin: 'task_notification' };
    const fromPeer = {
      isMeta: true,
      promptSource: 'system',
      turnOrigin: 'peer',
      origin: { kind: 'peer', from: 'uds:/tmp/cc-socks/1.sock', name: 'random-ca', fromMode: 'prompting', body: '设计稿看完了。\n五条意见。' },
    };
    const fromHuman = { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' };

    it('shows a background task finishing as a line of its own, not as something the user said', () => {
      expect(chatItems(user(notification, fromTask))).toEqual([
        {
          k: 'note',
          event: { e: 'task', status: 'completed', what: 'Wait in background for MEM-727 to finish' },
          detail: 'Background command "Wait in background for MEM-727 to finish" completed (exit code 0)',
        },
        { k: 'bg', id: 'bdfoi2os0', status: 'completed' },
      ]);
    });

    it('says when a background task failed', () => {
      const failed = notification.replace('<status>completed', '<status>failed').replace('completed (exit code 0)', 'failed with exit code 1');
      expect(chatItems(user(failed, fromTask))).toEqual([
        {
          k: 'note',
          event: { e: 'task', status: 'failed', what: 'Wait in background for MEM-727 to finish' },
          detail: 'Background command "Wait in background for MEM-727 to finish" failed with exit code 1',
        },
        { k: 'bg', id: 'bdfoi2os0', status: 'failed' },
      ]);
    });

    it('shows a message from another session by who sent it, with the message to open', () => {
      expect(chatItems(user(`Another Claude session sent a message:\n<cross-session-message from="x">…`, fromPeer))).toEqual([
        { k: 'note', event: { e: 'peer', from: 'random-ca' }, detail: '设计稿看完了。\n五条意见。' },
      ]);
    });

    it('never draws as the user a prompt that came from anywhere but the user, kinds not known yet included', () => {
      const items = chatItems(user('something new', { origin: { kind: 'scheduled-wakeup' }, promptSource: 'system' }));
      expect(items.some((i) => i.k === 'user')).toBe(false);
      expect(items).toEqual([{ k: 'note', text: 'something new' }]);
    });

    it('leaves out text a sender other than the user meant for Claude alone', () => {
      expect(chatItems(user('[Image: original 1320x2868]', { ...fromTask, isMeta: true }))).toEqual([]);
    });

    it('goes by who sent it, not by what it says: the user typing the same text is still the user', () => {
      expect(chatItems(user(notification, fromHuman))).toEqual([{ k: 'user', text: notification, at }]);
    });

    // A teammate's message, as Claude Code (2.1.220 to 2.1.289 at least) records it: with no sender at all,
    // several at once, and with a status update among them that is meant for Claude.
    const teammates = (...blocks: string[]) =>
      `Another Claude session sent a message:\n${blocks.join('\n\n')}\n\nThis came from another Claude session — not typed by your user, but very likely working on their behalf.`;
    const said = (id: string, body: string) => `<teammate-message teammate_id="${id}" color="purple" summary="x">\n${body}\n</teammate-message>`;
    const idle = (id: string) =>
      `<teammate-message teammate_id="${id}" color="green">\n{"type":"idle_notification","from":"${id}","timestamp":"2026-10-05T07:51:01.093Z","idleReason":"available"}\n</teammate-message>`;

    it.each([
      ['one message', teammates(said('updates', '2.17.5 done.\n\nDeploy refuses a stale dist.')), [['updates', '2.17.5 done.\n\nDeploy refuses a stale dist.']]],
      ['several at once', teammates(said('tester', 'All green.'), said('mobile', 'Pushed.')), [['tester', 'All green.'], ['mobile', 'Pushed.']]],
      ['a status update alongside a message', teammates(idle('tester'), said('mobile', 'Pushed.')), [['mobile', 'Pushed.']]],
      ['only a status update', teammates(idle('tester')), []],
    ])('shows a teammate\'s message by who sent it, never as the user: %s', (_, text, sent) => {
      const items = chatItems(user(text));
      expect(items.some((i) => i.k === 'user')).toBe(false);
      expect(items).toEqual(sent.map(([from, detail]) => ({ k: 'note', event: { e: 'peer', from }, detail })));
    });

    it('treats a prompt with no sender recorded, from older Claude Code, as the user', () => {
      expect(chatItems(user('把按钮改成圆角'))).toEqual([{ k: 'user', text: '把按钮改成圆角', at }]);
    });
  });

  it('keeps a long tool result short, since the phone only needs a glance', () => {
    const [r] = chatItems(user([{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(50_000) }]));
    expect(r.k === 'result' && r.text.length).toBeLessThanOrEqual(2001);
  });
});

// The format is Claude Code's own and undocumented: replay what this Mac has, to hear about a change.
const realRoot = join(process.env.TEST_REAL_HOME!, '.claude/projects');
describe.skipIf(!existsSync(realRoot))('on this Mac\'s real transcripts', () => {
  const recent = () =>
    readdirSync(realRoot)
      .flatMap((d) => {
        try {
          return readdirSync(join(realRoot, d)).filter((n) => n.endsWith('.jsonl')).map((n) => join(realRoot, d, n));
        } catch {
          return [];
        }
      })
      .map((p) => ({ p, s: statSync(p) }))
      .filter(({ s }) => s.size < 20 * 1024 * 1024)
      .sort((a, b) => b.s.mtimeMs - a.s.mtimeMs)
      .slice(0, 30);

  it('reads recent transcripts without failing, and every tool call it shows has a name', async () => {
    const files = recent();
    let items = 0;
    for (const { p } of files) {
      const r = await readChatBefore(p, Number.MAX_SAFE_INTEGER, { turns: Infinity, maxRead: 20 * 1024 * 1024 });
      for (const i of r.items) if (i.k === 'tool') expect(i.name).toBeTruthy();
      items += r.items.length;
    }
    expect(items).toBeGreaterThan(100);
  });

  it('draws as the user only the prompts the user sent', () => {
    let others = 0;
    for (const { p } of recent()) {
      for (const l of readFileSync(p, 'utf8').split('\n')) {
        let r: { type?: unknown; origin?: { kind?: unknown } } | null = null;
        try {
          r = JSON.parse(l);
        } catch {
          continue;
        }
        if (r?.type !== 'user' || !r.origin || r.origin.kind === 'human') continue;
        others++;
        expect(chatItems(r).filter((i) => i.k === 'user')).toEqual([]);
      }
    }
    // Recent transcripts hold task notifications and messages from other sessions; with none, this checked nothing.
    expect(others).toBeGreaterThan(0);
  });
});
