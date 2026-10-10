import { join } from 'node:path';
import { Conflict } from '../../system/errors.js';
import { messagesFor } from '../../system/messages.js';
import { beginOp, opRunning, type OpKind } from '../../ops/lastOp.js';
import { recentProblems } from '../../ops/problems.js';
import { macReport } from '../../ops/report.js';
import { rollbackTarget } from '../../ops/release.js';
import type { RouteModule } from './context.js';

// The This Mac page: what the Mac's checks say, which build runs, what went wrong lately, and a restart or a
// rollback, done by a helper process since a server cannot restart itself.
export const register: RouteModule = (app, ctx) => {
  const ops = ctx.deps.ops;
  if (!ops) return;

  app.get<{ Querystring: { lang?: string } }>('/api/mac', async (req) => {
    const languages = [req.query.lang ?? '', ...String(req.headers['accept-language'] ?? '').split(',').map((l) => l.split(';')[0].trim())];
    return macReport(ops, messagesFor(languages.filter(Boolean)));
  });

  app.get('/api/mac/problems', async () => recentProblems(join(ops.home, 'logs/workoffdesk.log')));

  const hand = (op: OpKind) => {
    if (!ops.managed) throw new Conflict('this server was not started by launchd', 'not-managed');
    if (opRunning(ops.home)) throw new Conflict('a restart or rollback is already running', 'op-busy');
    beginOp(ops.home, op, ops.spawnOp(op));
  };

  app.post('/api/mac/restart', async (req, reply) => {
    hand('restart');
    req.log.info('restart asked for from a screen');
    return reply.code(202).send({});
  });

  app.post<{ Body: { to?: unknown } }>('/api/mac/rollback', async (req, reply) => {
    const to = rollbackTarget(ops.home);
    if (!to || req.body?.to !== to) throw new Conflict('the release before is not the one named', 'rollback-moved');
    hand('rollback');
    req.log.info({ to }, 'rollback asked for from a screen');
    return reply.code(202).send({});
  });
};
