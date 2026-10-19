// Draws Claude Code's /tasks dialog as 2.1.303 does (tests/fixtures/screens/tasks-*.txt): a list whose rows look
// like a question's options, ↑/↓ to select, Enter to open one, x to stop it, ← back from one opened, Esc to
// close. Every key it gets goes on a line of the log file.
import { appendFileSync } from 'node:fs';

const [log] = process.argv.slice(2);
const rule = '─'.repeat(60);
const rows = ['sleep 901', 'pnpm dev'];
let at = 0;
let open = false;
let closed = false;
const draw = () => {
  process.stdout.write('\x1b[2J\x1b[H');
  if (closed) {
    process.stdout.write(`${rule}\r\n❯ \r\n${rule}\r\n  Alice  Opus 5.5\r\n`);
    return;
  }
  const lines = open
    ? [rule, '  Shell details', '', '  Status:   running', '  Runtime:  46s', `  Command:  ${rows[at]}`, '', '  Output:', '  ready in 300 ms', '', '  ← to go back · Esc/Enter/Space to close · x to stop']
    : [
        rule,
        '  Background',
        rows.length ? `  ${rows.length} active shell${rows.length > 1 ? 's' : ''}` : '',
        '',
        ...(rows.length ? rows.map((r, i) => `  ${i === at ? '❯' : ' '} ⏺ ${r.padEnd(10)}  running`) : ['  No tasks currently running']),
        '',
        `  ↑/↓ to select · Enter to view${rows.length ? ' · x to stop' : ''} · Esc to close`,
      ];
  process.stdout.write(lines.join('\r\n'));
};
process.stdin.setRawMode(true);
process.stdin.on('data', (d) => {
  for (const key of d.toString().match(/\x1b\[[A-D]|[\s\S]/g) ?? []) {
    appendFileSync(log, `${JSON.stringify(key)}\n`);
    if (key === '\x1b') closed = true;
    else if (open && key === '\x1b[D') open = false;
    else if (!open && key === '\x1b[A') at = Math.max(at - 1, 0);
    else if (!open && key === '\x1b[B') at = Math.min(at + 1, rows.length - 1);
    else if (!open && key === '\r' && rows.length) open = true;
    else if (key === 'x' && rows.length) {
      rows.splice(at, 1);
      at = Math.min(at, rows.length - 1);
      open = false;
    }
  }
  draw();
  if (closed) process.exit(0);
});
draw();
