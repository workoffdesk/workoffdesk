import { isDir } from '../../system/dirs.js';
import type { AppDeps } from '../app.js';
import type { CodexOnMac } from '../../agents/codex/threads.js';
import { allClaude, oneClaude, recentClaude } from './claude.js';
import type { RouteModule } from './context.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// How many items a read of a Codex conversation gives at most: the latest, or those before a place.
const PAGE = 400;
// The conversations on the Mac a page gives, unless asked for another number, and at most.
const PAGE_CONVERSATIONS = 50;
const MAX_CONVERSATIONS = 200;

// The Codex conversations people had on this Mac, in the shape of the Claude ones: background is "open in
// another Codex app", which cannot be gone on with here.
function recentCodex(deps: AppDeps) {
  return codexRows(deps, () => deps.machine.codexOnMac());
}

async function codexRows(deps: AppDeps, list: () => Promise<CodexOnMac[]>) {
  const { machine } = deps;
  const [threads, sessions] = await Promise.all([list().catch(() => []), machine.listSessions()]);
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

  // Every conversation people had on this Mac that its agent still keeps, newest first, a page at a time: at most
  // limit of those last active before `before`, and whether there are more. q: in the title, folder or what was
  // said last. One a session here holds, running or past, is in the list of sessions instead.
  app.get<{ Querystring: { q?: string; before?: string; limit?: string } }>('/api/conversations', async (req, reply) => {
    const limit = req.query.limit === undefined ? PAGE_CONVERSATIONS : Number(req.query.limit);
    const before = req.query.before === undefined ? Infinity : Number(req.query.before);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CONVERSATIONS) return reply.code(400).send({ error: 'bad limit' });
    if (Number.isNaN(before)) return reply.code(400).send({ error: 'bad before' });
    const q = (req.query.q ?? '').trim().toLowerCase();
    const [claude, codex, sessions] = await Promise.all([allClaude(deps), codexRows(deps, () => machine.allCodexOnMac()), machine.listSessions()]);
    const held = new Set(sessions.flatMap((s) => [s.claudeSessionId, s.codexThreadId].filter((c) => c !== undefined)));
    const found = (r: { title: string; cwd: string | null; lastPrompt: string | null }) => [r.title, r.cwd, r.lastPrompt].some((t) => t?.toLowerCase().includes(q));
    const rows = [...claude, ...codex]
      .filter((r) => !r.automated && !held.has(r.sessionId) && r.lastActivity < before && found(r))
      .sort((a, b) => b.lastActivity - a.lastActivity);
    return { conversations: rows.slice(0, limit), more: rows.length > limit };
  });

  // One conversation, however old, as the lists have it: what its page shows and offers.
  app.get<{ Params: { agent: string; sid: string } }>('/api/conversations/:agent/:sid', async (req, reply) => {
    const { agent, sid } = req.params;
    const row =
      agent === 'claude'
        ? await oneClaude(deps, sid)
        : agent === 'codex' && UUID.test(sid)
          ? ((await codexRows(deps, async () => [await machine.oneCodexOnMac(sid)].filter((t) => t !== null)))[0] ?? null)
          : null;
    return row ?? reply.code(404).send({ error: 'no such conversation' });
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
    const latest = page(Math.max(0, end - PAGE), end);
    if (req.query.sid !== id || from > end) return latest;
    if (before !== null) return page(Math.max(0, Math.min(before, end) - PAGE), Math.min(before, end));
    return end - from > PAGE ? latest : page(from, end);
  });

  // Stops waiting to take a thread over from the Mac.
  app.delete<{ Params: { id: string } }>('/api/codex/threads/:id/take-over', async (req, reply) =>
    machine.cancelTakeOver(req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: 'not waiting' }),
  );
};
