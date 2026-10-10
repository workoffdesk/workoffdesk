import { readFileSync } from 'node:fs';

// Draws a question the way Claude Code does and answers arrow keys, digits and Enter, as its picker does.
const [, , file] = process.argv;
const { question, options } = JSON.parse(readFileSync(file, 'utf8'));
const all = [...options, ['Type something.', null]];
let at = 0;
const draw = () => {
  const out = ['─'.repeat(60), ...question.map((l) => ` ${l}`), ''];
  all.forEach(([o, d], i) => {
    out.push(`${i === at ? '❯' : ' '} ${i + 1}. ${o}`);
    if (d) out.push(`     ${d}`);
  });
  out.push('─'.repeat(60), '  5. Chat about this', '', 'Enter to select · ↑/↓ to navigate · Esc to cancel');
  process.stdout.write('\x1b[2J\x1b[H' + out.join('\n') + '\n');
};
process.stdin.setRawMode(true);
process.stdin.on('data', (b) => {
  const s = b.toString();
  if (s.includes('\x1b[B')) at = Math.min(at + 1, all.length - 1);
  else if (s.includes('\x1b[A')) at = Math.max(at - 1, 0);
  else if (/^[1-9]$/.test(s)) at = Math.min(Number(s) - 1, all.length - 1);
  if (s.includes('\r') || s === '\x1b') {
    process.stdout.write('\x1b[2J\x1b[H');
    process.exit(0);
  }
  draw();
});
draw();
