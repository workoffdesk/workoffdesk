import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { idOfTmuxName, tmuxName } from '../sessions/sessionName.js';
import { m } from '../system/messages.js';
import { homeDir, tmuxSocketFor } from '../system/paths.js';
import { shownTitle, Store } from '../system/store.js';
import { Tmux } from '../system/tmux.js';
import { ask, fail } from './common.js';

export async function attach(args: string[]) {
  const home = homeDir();
  const tmux = new Tmux({ socket: tmuxSocketFor(home), conf: join(home, 'tmux.conf') });
  const ids = (await tmux.listSessions()).flatMap((s) => idOfTmuxName(s.name) ?? []);
  if (!ids.length) fail(m.cli.noSessions);
  let id = args[0];
  if (!id) {
    const meta = new Store(join(home, 'state.json')).get().sessions;
    ids.forEach((sid, i) => {
      const info = meta[sid];
      console.log(`${i + 1}) ${sid}  ${info ? shownTitle(info) : ''}  ${info?.cwd ?? ''}`);
    });
    const pick = Number(await ask(m.cli.whichOne));
    id = ids[pick - 1] ?? fail(m.cli.noSuchNumber);
  }
  const r = spawnSync(tmux.bin, tmux.attachArgs(tmuxName(id)), { stdio: 'inherit', env: tmux.env() });
  process.exit(r.status ?? 0);
}
