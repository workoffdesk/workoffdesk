import { accessSync, constants, mkdirSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { delimiter, join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import webpush from 'web-push';
import { buildApp } from './app.js';
import { registerPasskeyRoutes } from './auth/passkey.js';
import { startControlServer } from '../sessions/control.js';
import { startHookServer, userStatusLine, writeClaudeSettings } from '../agents/claude/hooks/hooks.js';
import { usageFrom } from '../agents/claude/usage.js';
import { ClaudeAccounts } from '../agents/claude/accounts.js';
import { createHookHandler, createPermissionHandler } from '../agents/claude/hooks/tracker.js';
import type { Config } from '../system/config.js';
import type { OpsDeps } from '../ops/report.js';
import { createLogger } from '../system/log.js';
import { LocalMachine } from '../sessions/machine.js';
import { socketPath, tmuxSocketFor } from '../system/paths.js';
import { Apns, loadApnsKey, type ApnsPost } from '../notify/apns.js';
import { Pusher } from '../notify/push.js';
import { Store } from '../system/store.js';
import { Tmux, writeTmuxConf } from '../system/tmux.js';

export class NotSetUp extends Error {}

const isExecutable = (f: string) => {
  try {
    accessSync(f, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

// npx and pnpm put node_modules/.bin first on PATH, where a stale npm-installed
// claude can shadow the real one; the official installer puts it in ~/.local/bin.
export function resolveClaude(env: NodeJS.ProcessEnv = process.env, userHome = homedir()): string {
  const dirs = [join(userHome, '.local/bin'), ...(env.PATH ?? '').split(delimiter).filter((d) => d && !d.includes('node_modules'))];
  return dirs.map((d) => join(d, 'claude')).find(isExecutable) ?? 'claude';
}

// Codex's CLI where its installer or npm puts it; null when it is not installed.
export function resolveCodex(env: NodeJS.ProcessEnv = process.env, userHome = homedir()): string | null {
  const dirs = [join(userHome, '.local/bin'), ...(env.PATH ?? '').split(delimiter).filter((d) => d && !d.includes('node_modules'))];
  return dirs.map((d) => join(d, 'codex')).find(isExecutable) ?? null;
}

export type ServerOptions = {
  home: string;
  config: Config;
  webDir?: string;
  claudeBin?: string;
  // Null leaves Codex sessions out.
  codexBin?: string | null;
  claudeProjectsRoot?: string;
  claudeJobsRoot?: string;
  claudeDir?: string;
  // The Claude accounts sessions can run on; those in the user's home unless given.
  claudeAccounts?: ClaudeAccounts;
  tmuxSocket?: string;
  pushSend?: ConstructorParameters<typeof Pusher>[1]['send'];
  apnsPost?: ApnsPost;
  watchMs?: number;
  appUpdate?: { dir: string; activatedFile?: string };
  // Where the server's log goes; logs/workoffdesk.log under home unless given.
  logger?: FastifyBaseLogger;
  // The This Mac page's report and operations.
  ops?: OpsDeps;
};

export async function startServer(o: ServerOptions) {
  const store = new Store(join(o.home, 'state.json'));
  if (!store.get().user) throw new NotSetUp();
  mkdirSync(join(o.home, 'logs'), { recursive: true });

  if (!store.get().vapid) {
    const keys = webpush.generateVAPIDKeys();
    store.update((s) => {
      s.vapid = { publicKey: keys.publicKey, privateKey: keys.privateKey };
    });
  }

  const conf = join(o.home, 'tmux.conf');
  writeTmuxConf(conf);
  const tmux = new Tmux({ socket: o.tmuxSocket ?? tmuxSocketFor(o.home), conf });
  const claudeSettingsPath = join(o.home, 'claude-settings.json');
  const hookSock = socketPath(o.home, 'hooks.sock');
  writeClaudeSettings(claudeSettingsPath, hookSock, userStatusLine(join(o.claudeDir ?? join(homedir(), '.claude'), 'settings.json')));

  const claudeBin = o.claudeBin ?? resolveClaude();
  const codexBin = o.codexBin === undefined ? resolveCodex() : o.codexBin;
  const logger = o.logger ?? createLogger({ file: join(o.home, 'logs/workoffdesk.log') });
  const machine = new LocalMachine({
    tmux,
    store,
    claudeSettingsPath,
    claudeBin,
    claudeArgs: o.config.claudeArgs,
    claudeProjectsRoot: o.claudeProjectsRoot ?? join(homedir(), '.claude/projects'),
    claudeAccounts: o.claudeAccounts ?? new ClaudeAccounts({ home: homedir(), projectsRoot: o.claudeProjectsRoot ?? join(homedir(), '.claude/projects'), own: process.env.CLAUDE_CONFIG_DIR || undefined }),
    shell: process.env.SHELL || userInfo().shell || '/bin/zsh',
    journal: { file: join(o.home, 'journal.db'), log: (msg, fields) => logger.info(fields, msg) },
    codex: codexBin ? { bin: codexBin, sock: socketPath(o.home, 'codex.sock'), home: process.env.CODEX_HOME || join(homedir(), '.codex') } : undefined,
  });
  // Push services want a contact URL; Apple rejects anything but https: or mailto:.
  const subject = o.config.origin.startsWith('https://') ? o.config.origin : 'mailto:workoffdesk@localhost';
  const apnsKey = loadApnsKey(o.home);
  const pusher = new Pusher(store, { subject, send: o.pushSend, apns: apnsKey ? new Apns(apnsKey, o.apnsPost) : undefined });
  machine.setNotifier(pusher);
  const hooks = await startHookServer(
    hookSock,
    createHookHandler(machine, pusher),
    (id, payload) => machine.setUsage(id, usageFrom(payload)),
    createPermissionHandler(machine, pusher),
  );
  const control = await startControlServer(socketPath(o.home, 'control.sock'), {
    open: async ({ kind, env, ...r }) => (await machine.createSession(kind === 'codex' ? { kind, ...r } : { kind: 'claude', env, ...r })).id,
    accounts: {
      view: () => machine.claudeAccountsView(),
      pick: async (id) => {
        const view = await machine.pickClaudeAccount(id);
        logger.info({ account: id, from: 'cli' }, 'claude account picked');
        return view;
      },
      move: async () => {
        const view = await machine.moveToAccountInUse();
        logger.info({ moving: view.moving, from: 'cli' }, 'open sessions moving to the claude account in use');
        return view;
      },
    },
    activity: { working: () => machine.working(), onChange: (cb) => machine.onChange(cb) },
  });
  const stopWatch = machine.watch(o.watchMs ?? 2000);

  const { app } = await buildApp({
    logger,
    store,
    machine,
    origin: o.config.origin,
    rpId: o.config.rpId,
    extraOrigins: o.config.extraOrigins,
    auditPath: join(o.home, 'logs/audit.log'),
    webDir: o.webDir,
    pusher,
    claudeProjectsRoot: o.claudeProjectsRoot ?? join(homedir(), '.claude/projects'),
    claudeJobsRoot: o.claudeJobsRoot ?? join(homedir(), '.claude/jobs'),
    claudeDir: o.claudeDir ?? join(homedir(), '.claude'),
    claudeBin,
    pinnedDirs: o.config.pinnedDirs,
    media: { uploadsDir: join(o.home, 'uploads') },
    appUpdate: o.appUpdate && { ...o.appUpdate, bundlesDir: join(o.home, 'app-bundles') },
    ops: o.ops,
    extend: (a, ctx) => registerPasskeyRoutes(a, ctx, { store }),
  });

  return {
    app,
    tmux,
    // The app first, so the phones hear 4012 before anything else stops.
    close: async () => {
      await app.close();
      stopWatch();
      hooks.close();
      // Prompts held for the phone go back to the Mac's dialog alone.
      hooks.closeAllConnections();
      control.close();
      // The menu bar app's watch ends, and it asks again of the next server.
      control.closeAllConnections();
      machine.closeJournal();
    },
  };
}
