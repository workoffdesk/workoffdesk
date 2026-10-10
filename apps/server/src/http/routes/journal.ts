import type { RouteModule } from './context.js';

const CONV = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const count = (s: string | undefined) => (s === undefined ? 0 : /^\d{1,15}$/.test(s) ? Number(s) : NaN);

// A session's journal for a copy to catch up on: the rows above the version it holds, and pages of older
// items of a conversation (docs/design/2026-10-06-session-journal-design.md).
export const register: RouteModule = (app, ctx) => {
  const { deps, machineOr404 } = ctx;
  const { machine } = deps;

  app.get<{ Params: { machine: string; id: string }; Querystring: { epoch?: string; v?: string } }>('/api/m/:machine/sessions/:id/journal', async (req, reply) => {
    const m = machineOr404(req, reply);
    if (!m) return reply;
    const v = count(req.query.v);
    if (!Number.isSafeInteger(v)) return reply.code(400).send({ error: 'bad version' });
    if (!(await m.exists(req.params.id))) return reply.code(404).send({ error: 'no such session' });
    // An answer is never behind the transcript, nor the screen (a copy that asks has no line reading it).
    if (machine.sessionMeta(req.params.id)?.kind === 'claude') await m.onScreen(req.params.id).catch(() => {});
    await machine.ingest(req.params.id);
    return machine.journal.sync(req.params.id, req.query.epoch, v);
  });

  app.get<{ Params: { machine: string; id: string }; Querystring: { conv?: string; before?: string } }>(
    '/api/m/:machine/sessions/:id/journal/items',
    async (req, reply) => {
      const m = machineOr404(req, reply);
      if (!m) return reply;
        const before = req.query.before === undefined ? NaN : count(req.query.before);
      const conv = req.query.conv ?? '';
      if (!Number.isSafeInteger(before) || !CONV.test(conv)) return reply.code(400).send({ error: 'conv and before required' });
      if (!(await m.exists(req.params.id))) return reply.code(404).send({ error: 'no such session' });
      return machine.journal.older(req.params.id, conv, before);
    },
  );
};
