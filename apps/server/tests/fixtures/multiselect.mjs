// Draws a question that takes several answers the way Claude Code does: a box before each option, an
// answer of one's own last, Submit under them; arrows move (Submit counting as one more row), Space
// ticks, Enter on Submit prints what was ticked. Options come as arguments; a leading + starts ticked.
const options = process.argv.slice(2).map((a) => ({ label: a.replace(/^\+/, ''), ticked: a.startsWith('+') }));
options.push({ label: 'Type something…', ticked: false, typed: true });
let at = 0;
const draw = () => {
  process.stdout.write('\x1b[2J\x1b[H ☐ Checks  ✓ Submit\r\n\r\nWhich checks?\r\n\r\n');
  options.forEach((o, i) =>
    process.stdout.write(`${i === at ? '❯ ' : '  '}${i + 1}. [${o.ticked ? '✔' : ' '}] ${o.label}\r\n`),
  );
  process.stdout.write(`\r\n   ${at === options.length ? '❯ ' : ''}Submit\r\n`);
  process.stdout.write('\r\nEnter to select · ↑/↓ to navigate · Esc to cancel\r\n');
};
process.stdin.setRawMode(true);
process.stdin.on('data', (d) => {
  for (const key of d.toString().match(/\x1b\[[AB]|[\s\S]/g) ?? []) {
    if (key === '\x1b[A') at = Math.max(0, at - 1);
    else if (key === '\x1b[B') at = Math.min(options.length, at + 1);
    else if (key === ' ' && at < options.length && !options[at].typed) options[at].ticked = !options[at].ticked;
    else if (key === '\r' && at === options.length) {
      process.stdout.write('\x1b[2J\x1b[H');
      console.log(`ticked: ${options.filter((o) => o.ticked).map((o) => o.label).join(',') || '(none)'}`);
      process.exit(0);
    }
  }
  draw();
});
draw();
