import { isDir } from '../../system/dirs.js';
import type { AppDeps } from '../app.js';
import { recentClaude } from './claude.js';
import type { RouteModule } from './context.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// How many items a read of a Codex conversation gives at most: the latest, or those before a place.
const PAGE = 400;

// The Codex conversations people had on this Mac, in the shape of the Claude ones: background is "open in
// another Codex app", which cannot be gone on with here.
async function recentCodex(deps: AppDeps) {
  const { machine } = deps;
  const [threads, sessions] = await Promise.all([machine.codexOnMac().catch(() => []), machine.listSessions()]);
  const open = new Map(sessions.filter((s) => s.codexThreadId).map((s) => [s.codexThreadId!, s.id]));
  return threads.map((t) => ({
    sessionId: t.id,
    cwd: t.cwd || null,
    title: t.title,
    lastActivity: t.lastActivity,
    automated: false,
    openIn: open.get(t.id) ?? null,
    background: t.holder?.at === 'elsewhere',
    lastPrompt: t.lastPrompt,
    onMac: t.holder?.at === 'terminal' ? { status: t.busy ? ('busy' as const) : ('idle' as const), terminals: 1 } : null,
    takingOver: machine.takingOver(t.id),
    folderGone: !!t.cwd && !isDir(t.cwd),
    agent: 'codex' as const,
  }));
}

// Codex threads on this Mac to read and pick up, and the list of every agent's conversations here.
export const register: RouteModule = (app, ctx) => {
  const { deps } = ctx;
  const { machine } = deps;

  app.get('/api/recent', async () => {
    const [claude, codex] = await Promise.all([recentClaude(deps), recentCodex(deps)]);
    return [...claude, ...codex].sort((a, b) => b.lastActivity - a.lastActivity);
  });

  // A thread's conversation, to read before picking it up here; the same shape and paging as a Claude one's,
  // with an item's place in the thread for a byte's in the transcript.
  app.get<{ Params: { id: string }; Querystring: { from?: string; before?: string; sid?: string } }>('/api/codex/threads/:id/chat', async (req, reply) => {
    const { id } = req.params;
    if (!UUID.test(id)) return reply.code(400).send({ error: 'bad thread id' });
    const from = Number(req.query.from ?? 0);
    const before = req.query.before === undefined ? null : Number(req.query.before);
    if (!Number.isSafeInteger(from) || from < 0) return reply.code(400).send({ error: 'bad from' });
    if (before !== null && (!Number.isSafeInteger(before) || before < 0)) return reply.code(400).send({ error: 'bad before' });
    const items = (await machine.codexChat(id)).map((e) => e.item);
    const end = items.length;
    const page = (start: number, stop: number) => ({ sid: id, items: items.slice(start, stop), from: start, next: stop, skipped: false });
    if (req.query.sid !== id || from > end) return page(Math.max(0, end - PAGE), end);
    if (before !== null) return page(Math.max(0, Math.min(before, end) - PAGE), Math.min(before, end));
    return page(from, end);
  });

  // Stops waiting to take a thread over from the Mac.
  app.delete<{ Params: { id: string } }>('/api/codex/threads/:id/take-over', async (req, reply) =>
    machine.cancelTakeOver(req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: 'not waiting' }),
  );
};
