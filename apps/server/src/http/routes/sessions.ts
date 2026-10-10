import { homedir } from 'node:os';
import { heldInBackground } from '../../agents/claude/transcript/transcripts.js';
import { listDirs } from '../../system/dirs.js';
import { Conflict } from '../../system/errors.js';
import type { CreateSpec } from '../../sessions/machine.js';
import { serveSession } from '../sessionSocket.js';
import type { RouteModule } from './context.js';

// The sessions of a machine: listed, started, renamed, ended, and the sockets that carry them live.
export const register: RouteModule = (app, ctx) => {
  const { deps, hub, admit, machineOr404 } = ctx;
  const { machine } = deps;

  app.get<{ Params: { machine: string } }>(
    '/api/m/:machine/sessions',
    async (req, reply) => {
      const m = machineOr404(req, reply);
      return m ? m.listSessions() : reply;
    },
  );

  app.post<{ Params: { machine: string }; Body: unknown }>(
    '/api/m/:machine/sessions',
    async (req, reply) => {
      const m = machineOr404(req, reply);
      if (!m) return reply;
      const parsed = parseCreateSpec(req.body);
      if (!parsed) return reply.code(400).send({ error: 'invalid session spec' });
      const { spec, takeOver } = parsed;
      if (spec.kind === 'claude' && spec.resumeId && deps.claudeJobsRoot && (await heldInBackground(deps.claudeJobsRoot))(spec.resumeId)) {
        throw new Conflict('this conversation is in a Claude background session and cannot be resumed here', 'background-session');
      }
      if (spec.kind !== 'shell' && spec.resumeId && takeOver === 'whenIdle') {
        const made = await m.takeOverWhenIdle({ ...spec, resumeId: spec.resumeId });
        return made ? reply.code(201).send(made) : reply.code(202).send({ waiting: true });
      }
      return reply.code(201).send(await m.createSession(spec.kind === 'shell' ? spec : { ...spec, takeOver: takeOver === 'now' }));
    },
  );

  // Goes on with the conversation of a session whose Claude quit, in that same session.
  app.post<{ Params: { machine: string; id: string } }>('/api/m/:machine/sessions/:id/continue', async (req, reply) => {
    const m = machineOr404(req, reply);
    if (!m) return reply;
    const sid = m.sessionMeta(req.params.id)?.claudeSessionId;
    if (sid && deps.claudeJobsRoot && (await heldInBackground(deps.claudeJobsRoot))(sid)) {
      throw new Conflict('this conversation is in a Claude background session and cannot be resumed here', 'background-session');
    }
    return m.continueSession(req.params.id);
  });

  app.get<{ Params: { machine: string } }>('/api/m/:machine/agents', async (req, reply) => {
    const m = machineOr404(req, reply);
    return m ? m.agents : reply;
  });

  // The folders a path typed in the new-session picker points into, only inside home.
  app.get<{ Params: { machine: string }; Querystring: { path?: string } }>('/api/m/:machine/dirs', async (req, reply) => {
    const m = machineOr404(req, reply);
    return m ? listDirs(req.query.path ?? '', homedir()) : reply;
  });

  app.delete<{ Params: { machine: string; id: string } }>(
    '/api/m/:machine/sessions/:id',
    async (req, reply) => {
      const m = machineOr404(req, reply);
      if (!m) return reply;
      await m.killSession(req.params.id);
      return reply.code(204).send();
    },
  );

  // A name of the session's own, for every device and for its agent's conversation; never an empty one.
  app.patch<{ Params: { machine: string; id: string }; Body: { title?: unknown } }>('/api/m/:machine/sessions/:id', async (req, reply) => {
    const m = machineOr404(req, reply);
    if (!m) return reply;
    const title = req.body?.title;
    if (typeof title !== 'string' || title.length > 4096) return reply.code(400).send({ error: 'title required' });
    const s = await m.renameSession(req.params.id, title);
    if (!s) return reply.code(404).send({ error: 'no such session' });
    return s;
  });

  app.get('/api/events', { websocket: true }, (socket, req) => {
    if (!admit(socket, req)) return;
    void hub.add(socket);
  });

  // What /api/events sends, for a client whose socket does not get through.
  app.get('/api/events/now', async (_req, reply) => (await hub.snapshot()) ?? reply.code(503).send({ error: 'unavailable' }));

  app.get<{ Params: { machine: string; id: string } }>(
    '/api/m/:machine/sessions/:id/ws',
    { websocket: true },
    (socket, req) => {
      if (!admit(socket, req)) return;
      if (req.params.machine !== machine.id) return socket.close(4404);
      void serveSession(
        socket,
        req.params.id,
        machine,
        deps.pusher && ((id, conn, v) => deps.pusher!.setVisible(id, conn, v)),
        {
          ingest: (id) => machine.ingest(id),
          sync: (id, epoch, v) => machine.journal.sync(id, epoch, v),
          onRows: (id, cb) => machine.journal.onRows(id, cb),
        },
      );
    },
  );
};

// takeOver: for a Claude or Codex conversation open in a terminal on the Mac, quit it there now, or once it is idle.
function parseCreateSpec(body: unknown): { spec: CreateSpec; takeOver?: 'now' | 'whenIdle' } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length < 4096 ? v : undefined);
  if (b.takeOver !== undefined && ((b.kind !== 'claude' && b.kind !== 'codex') || (b.takeOver !== 'now' && b.takeOver !== 'whenIdle'))) return null;
  if (b.kind === 'shell') return { spec: { kind: 'shell', cwd: str(b.cwd), title: str(b.title) } };
  if ((b.kind === 'claude' || b.kind === 'codex') && str(b.cwd)) {
    return { spec: { kind: b.kind, cwd: str(b.cwd)!, resumeId: str(b.resumeId), title: str(b.title) }, takeOver: b.takeOver as 'now' | 'whenIdle' | undefined };
  }
  return null;
}
