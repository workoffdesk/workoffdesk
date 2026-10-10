// Draws a dialog over a prompt the way Claude Code's /config does: its top edge a row of ▔, focus in a
// search box that the first Esc only clears, the second Esc closing it back to the prompt.
// Every key it gets goes on a line of the log file. With `usage`
// it is the usage tab instead, its weekly line running off the bottom. With `tall` it is /usage as a narrow
// phone gets it: a plain rule for its top edge, taller than the screen so that edge scrolls off, and one Esc
// closes it.
import { appendFileSync } from 'node:fs';

const [log, mode] = process.argv.slice(2);
let escs = 0;
const rule = '─'.repeat(40);
const draw = () => {
  process.stdout.write('\x1b[2J\x1b[H');
  if (escs >= (mode === 'tall' ? 1 : 2)) {
    process.stdout.write(`${rule}\r\n❯ \r\n${rule}\r\n  Alice  Opus 5.5\r\n`);
    return;
  }
  if (mode === 'tall') {
    const lines = [rule, '  Settings  Status   Config', '   Usage   Stats', '', '  Session', '', '  Total cost:            $24.43'];
    for (let i = 0; i < 60; i++) lines.push(`  claude-opus-5-5: line ${i} of what it used`);
    lines.push('', '  Current session · Resets 2am', '  ███████▎', '', '  9% used');
    process.stdout.write(lines.join('\r\n'));
    return;
  }
  process.stdout.write(`${'▔'.repeat(40)}\r\n   Settings  Status   Config   Usage   Stats\r\n\r\n`);
  if (mode === 'usage') {
    process.stdout.write('   Session\r\n\r\n   Total cost:            $1.23\r\n\r\n');
    process.stdout.write('   Current session · Resets 2am (Europe/Rome)\r\n   ████▏\r\n\r\n   9% used\r\n\r\n');
    process.stdout.write('   Current week (all models) · Resets Oct 8 at ↓\r\n');
    return;
  }
  process.stdout.write('   ❯ Auto-compact\r\n       true\r\n     Show tips\r\n       true\r\n\r\n');
  process.stdout.write(escs ? '   Enter/Space to change · / to search · Esc to close\r\n' : '   Type to filter · Esc to clear\r\n');
};
process.stdin.setRawMode(true);
process.stdin.on('data', (d) => {
  for (const key of d.toString()) {
    appendFileSync(log, `${JSON.stringify(key)}\n`);
    if (key === '\x1b') {
      escs++;
      draw();
    }
  }
});
draw();
