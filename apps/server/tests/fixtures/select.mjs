// Draws a choice the way Claude Code does (❯ on the current option, arrows to move, Enter to take it)
// and prints what was taken. Options come as arguments.
const options = process.argv.slice(2);
let at = 0;
const draw = () => {
  process.stdout.write('\x1b[2J\x1b[H Which one?\r\n\r\n');
  options.forEach((o, i) => process.stdout.write(`${i === at ? ' ❯ ' : '   '}${i + 1}. ${o}\r\n`));
  process.stdout.write('\r\n Enter to select · ↑/↓ to navigate · Esc to cancel\r\n');
};
process.stdin.setRawMode(true);
process.stdin.on('data', (d) => {
  for (const key of d.toString().match(/\x1b\[[AB]|[\s\S]/g) ?? []) {
    if (key === '\x1b[A') at = Math.max(0, at - 1);
    else if (key === '\x1b[B') at = Math.min(options.length - 1, at + 1);
    else if (key === '\r') {
      process.stdout.write('\x1b[2J\x1b[H');
      console.log(`picked: ${options[at]}`);
      process.exit(0);
    }
  }
  draw();
});
draw();
