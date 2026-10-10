import { join } from 'node:path';
import { hashPassword, MIN_PASSWORD } from '../http/auth/password.js';
import { writeConfig } from '../system/config.js';
import { m } from '../system/messages.js';
import { homeDir } from '../system/paths.js';
import { Store } from '../system/store.js';
import { ask, configForSetup, fail, flag, readStdinLine, showQr } from './common.js';
import { setupWeb } from './setupWeb.js';

export async function setup(args: string[]) {
  if (args.includes('--web')) return setupWeb();
  const home = homeDir();
  const config = await configForSetup(home, flag(args, 'origin'));
  const username = flag(args, 'username') ?? (await ask(m.cli.askUsername)).trim();
  if (!username) fail(m.cli.emptyUsername);
  let password: string;
  if (process.stdin.isTTY) {
    password = await ask(m.cli.askPassword(MIN_PASSWORD), true);
    if ((await ask(m.cli.askAgain, true)) !== password) fail(m.cli.passwordsDiffer);
  } else {
    password = await readStdinLine();
  }
  if ([...password].length < MIN_PASSWORD) fail(m.cli.passwordTooShort(MIN_PASSWORD));
  const hash = await hashPassword(password);
  new Store(join(home, 'state.json')).update((s) => {
    s.user = { username, hash };
    s.logins = [];
  });
  writeConfig(home, config);
  console.log(m.cli.setUp(username, config.origin, join(home, 'config.json'), config.port));
  showQr(config.origin);
}
