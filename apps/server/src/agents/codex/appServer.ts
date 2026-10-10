import { homedir } from 'node:os';
import type { Tmux } from '../../system/tmux.js';
import { CodexRpc } from './rpc.js';

// Its own tmux session, so it outlives a restart of this server as the sessions' TUIs do; not named like a
// session (sessionName.ts), so no listing shows it.
export const APP_SERVER_TMUX = 'workoffdesk-codex';

const STARTS_MS = 15_000;
const LOOK_MS = 250;

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export type AppServerOptions = { tmux: Tmux; sock: string; codexBin: string; shell: string };

// The command a session's terminal runs: Codex's TUI on the shared app server, in the session's folder.
export function tuiCommand(o: { sock: string; codexBin: string; shell: string; cwd: string; resume?: string }): string {
  const resume = o.resume ? ` resume ${shq(o.resume)}` : '';
  const inner = `${shq(o.codexBin)} --remote ${shq(`unix://${o.sock}`)} -C ${shq(o.cwd)} -c check_for_update_on_startup=false${resume}; exec ${shq(o.shell)} -l`;
  return `${shq(o.shell)} -lc ${shq(inner)}`;
}

// A connection to the app server, started first when nothing answers on its socket. A tmux session left
// from one that died is ended before another is started.
export async function connectAppServer(o: AppServerOptions): Promise<CodexRpc> {
  try {
    return await CodexRpc.connect(o.sock);
  } catch {
    // not running; started below
  }
  await o.tmux.killSession(APP_SERVER_TMUX);
  const inner = `exec ${shq(o.codexBin)} app-server --listen ${shq(`unix://${o.sock}`)}`;
  await o.tmux.newSession(APP_SERVER_TMUX, { cwd: homedir(), command: `${shq(o.shell)} -lc ${shq(inner)}`, env: {} });
  const until = Date.now() + STARTS_MS;
  for (;;) {
    await new Promise((r) => setTimeout(r, LOOK_MS));
    try {
      return await CodexRpc.connect(o.sock);
    } catch (e) {
      if (Date.now() > until) throw new Error(`the Codex app server did not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
