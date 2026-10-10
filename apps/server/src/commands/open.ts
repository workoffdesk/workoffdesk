import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { askToOpen } from '../sessions/control.js';
import { tmuxName } from '../sessions/sessionName.js';
import { fromTerminal } from '../sessions/terminalEnv.js';
import { m } from '../system/messages.js';
import { homeDir, socketPath, tmuxSocketFor } from '../system/paths.js';
import { Tmux } from '../system/tmux.js';
import { fail, flag } from './common.js';

// A Claude or Codex session opened in this terminal's directory and joined at once: this Mac has it as a
// terminal, the phone as a chat.
export async function openHere(kind: 'claude' | 'codex', args: string[]) {
  const home = homeDir();
  const resumeId = flag(args, 'resume');
  let id: string;
  try {
    id = await askToOpen(socketPath(home, 'control.sock'), {
      kind,
      cwd: process.cwd(),
      ...(resumeId ? { resumeId } : {}),
      ...(kind === 'claude' ? { env: fromTerminal(process.env) } : {}),
    });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    fail(code === 'ENOENT' || code === 'ECONNREFUSED' ? m.cli.notRunning : m.cli.couldNotOpen((e as Error).message));
  }
  const tmux = new Tmux({ socket: tmuxSocketFor(home), conf: join(home, 'tmux.conf') });
  const r = spawnSync(tmux.bin, tmux.attachArgs(tmuxName(id)), { stdio: 'inherit', env: tmux.env() });
  process.exit(r.status ?? 0);
}
