import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { askToGoOn } from '../sessions/control.js';
import { idOfTmuxName, tmuxName } from '../sessions/sessionName.js';
import { m } from '../system/messages.js';
import { homeDir, socketPath, tmuxSocketFor } from '../system/paths.js';
import { shownTitle, Store, type SessionMeta, type State } from '../system/store.js';
import { Tmux } from '../system/tmux.js';
import { ask, fail } from './common.js';

export type AttachChoice = { id: string; meta: SessionMeta | undefined; ended: boolean };

// The running sessions as tmux has them, then the ended ones with a conversation to go on with, the latest first.
export function attachChoices(live: string[], st: Pick<State, 'sessions' | 'past'>): AttachChoice[] {
  const ended = Object.entries(st.past)
    .filter(([id, p]) => !live.includes(id) && (p.claudeSessionId || p.codexThreadId))
    .sort(([, a], [, b]) => b.lastActivity - a.lastActivity)
    .map(([id, p]): AttachChoice => ({ id, meta: p, ended: true }));
  return [...live.map((id): AttachChoice => ({ id, meta: st.sessions[id], ended: false })), ...ended];
}

// An ended session is gone on with by the server, as the phone does it, so one conversation has one Claude.
export async function attach(args: string[]) {
  const home = homeDir();
  const tmux = new Tmux({ socket: tmuxSocketFor(home), conf: join(home, 'tmux.conf') });
  const live = (await tmux.listSessions()).flatMap((s) => idOfTmuxName(s.name) ?? []);
  const choices = attachChoices(live, new Store(join(home, 'state.json')).get());
  let choice: AttachChoice | undefined = args[0] ? (choices.find((c) => c.id === args[0]) ?? { id: args[0], meta: undefined, ended: false }) : undefined;
  if (!choice) {
    if (!choices.length) fail(m.cli.noSessions);
    choices.forEach((c, i) => {
      console.log(`${i + 1}) ${c.id}  ${c.meta ? shownTitle(c.meta) : ''}  ${c.meta?.cwd ?? ''}${c.ended ? `  ${m.cli.ended}` : ''}`);
    });
    choice = choices[Number(await ask(m.cli.whichOne)) - 1] ?? fail(m.cli.noSuchNumber);
  }
  let id = choice.id;
  if (choice.ended) {
    try {
      id = await askToGoOn(socketPath(home, 'control.sock'), id);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      fail(code === 'ENOENT' || code === 'ECONNREFUSED' ? m.cli.notRunning : m.cli.couldNotGoOn((e as Error).message));
    }
  }
  const r = spawnSync(tmux.bin, tmux.attachArgs(tmuxName(id)), { stdio: 'inherit', env: tmux.env() });
  process.exit(r.status ?? 0);
}
