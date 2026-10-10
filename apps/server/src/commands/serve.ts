import { spawn } from 'node:child_process';
import { NotSetUp, startServer } from '../http/serve.js';
import { keepAwake } from '../ops/awake.js';
import { runDoctor } from '../ops/doctor.js';
import { isManaged } from '../ops/service.js';
import { shutdownOnce } from '../ops/shutdown.js';
import { m } from '../system/messages.js';
import { homeDir } from '../system/paths.js';
import { ACTIVATED_FILE, APP_UPDATE_DIR, PACKAGE_ROOT, WEB_DIR, fail, loadConfigOrFail, spawnOp } from './common.js';
import { doctorDeps } from './doctor.js';

export async function serve() {
  const home = homeDir();
  const config = loadConfigOrFail(home, 78);
  let server;
  try {
    server = await startServer({
      home,
      config,
      webDir: WEB_DIR,
      // A release is the whole package folder, dist/server/cli.js inside it.
      appUpdate: { dir: APP_UPDATE_DIR, activatedFile: ACTIVATED_FILE },
      ops: {
        home,
        managed: isManaged(process.env, config.serviceLabel),
        startedAt: Date.now(),
        buildRoot: PACKAGE_ROOT,
        doctor: (messages) => runDoctor({ ...doctorDeps(home), messages }),
        spawnOp: (op) => spawnOp(home, op),
      },
    });
  } catch (e) {
    if (e instanceof NotSetUp) fail(m.cli.notSetUp);
    throw e;
  }
  await server.app.listen({ port: config.port, host: '127.0.0.1' });
  server.app.log.info({ port: config.port, origin: config.origin }, 'started');
  keepAwake({ enabled: config.preventSleep, platform: process.platform, pid: process.pid, spawn, log: (msg, err) => server.app.log.warn({ err }, msg) });
  if (process.stdout.isTTY) console.log(m.cli.running(config.port, config.origin));
  const stop = shutdownOnce(server.close, { timeoutMs: 10_000, exit: (code) => process.exit(code) });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
