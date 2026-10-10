#!/usr/bin/env node
import { account } from './commands/account.js';
import { attach } from './commands/attach.js';
import { doctor } from './commands/doctor.js';
import { install } from './commands/install.js';
import { openHere } from './commands/open.js';
import { serve } from './commands/serve.js';
import { deployCommand, restartCommand, rollbackCommand, startCommand, stopCommand } from './commands/service.js';
import { setup } from './commands/setup.js';
import { status } from './commands/status.js';
import { m, type Messages } from './system/messages.js';
import { VERSION } from './system/version.js';

// Columns a string takes in a terminal: CJK characters take two.
const columns = (s: string) => [...s].reduce((n, c) => n + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(c) ? 2 : 1), 0);

function helpText(): string {
  const rows = Object.values(m.cli.help).flat();
  const width = Math.max(...rows.map(([form]) => columns(form)));
  return [m.cli.usage, '', ...rows.map(([form, what]) => `  ${form}${' '.repeat(width - columns(form))}  ${what}`)].join('\n');
}

type Command = Exclude<keyof Messages['cli']['help'], '--version' | '--help'>;

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === '--version' || cmd === '-v') {
  console.log(VERSION);
  process.exit(0);
}
if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
  console.log(helpText());
  process.exit(0);
}
const commands = {
  setup,
  serve,
  doctor,
  status,
  attach,
  account,
  claude: (args) => openHere('claude', args),
  codex: (args) => openHere('codex', args),
  install,
  start: startCommand,
  stop: stopCommand,
  restart: restartCommand,
  deploy: deployCommand,
  rollback: rollbackCommand,
} satisfies Record<Command, (args: string[]) => unknown>;
if (!Object.hasOwn(commands, cmd)) {
  console.error(`${m.cli.unknownCommand(cmd)}\n\n${helpText()}`);
  process.exit(1);
}
await commands[cmd as Command](rest);
