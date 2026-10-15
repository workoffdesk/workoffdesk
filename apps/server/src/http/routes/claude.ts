import { findSubagent, findTranscript, readChat, readChatBefore } from '../../agents/claude/transcript/transcriptFile.js';
import { heldInBackground, listAllClaudeSessions, listProjectDirs, listRecentClaudeSessions, oneClaudeSession, type RecentClaudeSession } from '../../agents/claude/transcript/transcripts.js';
import { isDir } from '../../system/dirs.js';
import { InvalidRequest, NotFound } from '../../system/errors.js';
import type { FastifyReply } from 'fastify';
import type { AppDeps } from '../app.js';
import type { RouteModule } from './context.js';

// The Claude conversations people had on this Mac lately, and where each is open now.
// How old a look at the Mac's terminals the list may show: a page open on a conversation asks every few seconds.
const MAC_SEEN_MS = 10_000;

export function recentClaude(deps: AppDeps) {
  return claudeRows(deps, (root) => listRecentClaudeSessions(root));
}

// Every Claude conversation Claude Code still keeps on this Mac, however old.
export function allClaude(deps: AppDeps) {
  return claudeRows(deps, listAllClaudeSessions);
}

// One Claude conversation on this Mac, as the lists have it; null when Claude Code keeps none by that id.
export async function oneClaude(deps: AppDeps, sid: string) {
  const [row] = await claudeRows(deps, async (root) => {
    const r = await oneClaudeSession(root, sid);
    return r ? [r] : [];
  });
  return row ?? null;
}

async function claudeRows(deps: AppDeps, list: (root: string) => Promise<RecentClaudeSession[]>) {
  const { machine } = deps;
  if (!deps.claudeProjectsRoot) return [];
  const [recent, sessions, held, onMac] = await Promise.all([
    list(deps.claudeProjectsRoot),
    machine.listSessions(),
    deps.claudeJobsRoot ? heldInBackground(deps.claudeJobsRoot) : () => false,
    machine.openOnMac(MAC_SEEN_MS),
  ]);
  // An ended session is gone on with by Continue, which, with the conversation open on the Mac, leads to taking it over.
  const open = new Map(sessions.filter((s) => s.claudeSessionId && s.status !== 'ended').map((s) => [s.claudeSessionId!, s.id]));
  return recent.map((r) => {
    const there = onMac.get(r.sessionId);
    return {
      ...r,
      title: machine.claudeName(r.sessionId) ?? r.title,
      openIn: open.get(r.sessionId) ?? null,
      background: held(r.sessionId),
      onMac: there ? { status: there.status, terminals: there.claudes.length } : null,
      takingOver: machine.takingOver(r.sessionId),
      folderGone: !!r.cwd && !isDir(r.cwd),
      agent: 'claude' as const,
    };
  });
}

// The conversation of the Claude on this Mac that sent a message, by its process, and the session here that
// goes on with it. The name it sent under is checked: a process gone since can be another Claude now.
export async function peerOf(deps: AppDeps, pid: number, name: string) {
  const c = await deps.machine.macClaudeOf(pid);
  if (!c || (c.name !== null && c.name !== name)) throw new NotFound('the Claude that sent this is no longer running on the Mac', 'peer-gone');
  const held = (await deps.machine.listSessions()).find((s) => s.claudeSessionId === c.sessionId && s.status !== 'ended');
  return { sid: c.sessionId, openIn: held?.id ?? null };
}

type ChatQuery = { from?: string; before?: string; sid?: string };

// A page of a transcript's chat, as a session's chat is paged: on from `from`, or back from `before`, both places
// in the transcript named `sid`; from its latest turns when the caller's copy is of another one.
async function chatPage(path: string, sid: string, q: ChatQuery, reply: FastifyReply, sidechain = false) {
  const from = Number(q.from ?? 0);
  const before = q.before === undefined ? null : Number(q.before);
  if (!Number.isSafeInteger(from) || from < 0) return reply.code(400).send({ error: 'bad from' });
  if (before !== null && (!Number.isSafeInteger(before) || before < 0)) return reply.code(400).send({ error: 'bad before' });
  if (q.sid !== sid) return { sid, ...(await readChat(path, 0, { sidechain })) };
  return { sid, ...(await (before === null ? readChat(path, from, { sidechain }) : readChatBefore(path, before, { sidechain }))) };
}

// Claude sessions on this Mac to pick up again, and the folders worth starting one in.
export const register: RouteModule = (app, ctx) => {
  const { deps } = ctx;
  const { machine } = deps;

  app.get('/api/claude/recent', () => recentClaude(deps));

  app.get<{ Params: { pid: string }; Querystring: { name?: string } }>('/api/claude/peers/:pid', (req) => {
    const pid = Number(req.params.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new InvalidRequest('bad process id');
    return peerOf(deps, pid, req.query.name ?? '');
  });

  // Stops waiting to take a conversation over from the Mac.
  app.delete<{ Params: { sid: string } }>('/api/claude/sessions/:sid/take-over', async (req, reply) =>
    machine.cancelTakeOver(req.params.sid) ? reply.code(204).send() : reply.code(404).send({ error: 'not waiting' }),
  );

  // A Claude session's conversation, by its session id, to read before picking it up here; the same shape
  // as a session's chat. Only a transcript under Claude Code's projects folder is read.
  app.get<{ Params: { sid: string }; Querystring: ChatQuery }>('/api/claude/sessions/:sid/chat', async (req, reply) => {
    const { sid } = req.params;
    const path = deps.claudeProjectsRoot ? await findTranscript(deps.claudeProjectsRoot, sid) : null;
    if (!path) return reply.code(404).send({ error: 'no such conversation' });
    return chatPage(path, sid, req.query, reply);
  });

  // A sub-agent the conversation started, by the call that started it: what it was started to do, and its own
  // conversation, read the same way.
  const subagent = (sid: string, tool: string) => (deps.claudeProjectsRoot ? findSubagent(deps.claudeProjectsRoot, sid, tool) : null);
  app.get<{ Params: { sid: string; tool: string } }>('/api/claude/sessions/:sid/agents/:tool', async (req, reply) => {
    const found = await subagent(req.params.sid, req.params.tool);
    if (!found) return reply.code(404).send({ error: 'no such sub-agent' });
    return { description: found.description };
  });
  app.get<{ Params: { sid: string; tool: string }; Querystring: ChatQuery }>('/api/claude/sessions/:sid/agents/:tool/chat', async (req, reply) => {
    const found = await subagent(req.params.sid, req.params.tool);
    if (!found) return reply.code(404).send({ error: 'no such sub-agent' });
    return chatPage(found.path, req.params.tool, req.query, reply, true);
  });

  // The Claude accounts on this Mac, the one new sessions run on, and a pick of another.
  app.get('/api/claude/accounts', () => machine.claudeAccountsView());
  app.put<{ Body: { id?: unknown } }>('/api/claude/account', async (req, reply) => {
    if (typeof req.body?.id !== 'string') return reply.code(400).send({ error: 'bad id' });
    const view = await machine.pickClaudeAccount(req.body.id);
    req.log.info({ account: req.body.id }, 'claude account picked');
    return view;
  });
  app.post('/api/claude/account/move', async (req) => {
    const view = await machine.moveToAccountInUse();
    req.log.info({ moving: view.moving }, 'open sessions moving to the claude account in use');
    return view;
  });

  app.get('/api/claude/projects', async () =>
    listProjectDirs(
      (await recentClaude(deps)).filter((r) => !r.folderGone),
      deps.pinnedDirs ?? [],
    ),
  );
};
