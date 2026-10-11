import { findTranscript, readChat, readChatBefore } from '../../agents/claude/transcript/transcriptFile.js';
import { heldInBackground, listAllClaudeSessions, listProjectDirs, listRecentClaudeSessions, oneClaudeSession, type RecentClaudeSession } from '../../agents/claude/transcript/transcripts.js';
import { isDir } from '../../system/dirs.js';
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
  const open = new Map(sessions.filter((s) => s.claudeSessionId).map((s) => [s.claudeSessionId!, s.id]));
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

// Claude sessions on this Mac to pick up again, and the folders worth starting one in.
export const register: RouteModule = (app, ctx) => {
  const { deps } = ctx;
  const { machine } = deps;

  app.get('/api/claude/recent', () => recentClaude(deps));

  // Stops waiting to take a conversation over from the Mac.
  app.delete<{ Params: { sid: string } }>('/api/claude/sessions/:sid/take-over', async (req, reply) =>
    machine.cancelTakeOver(req.params.sid) ? reply.code(204).send() : reply.code(404).send({ error: 'not waiting' }),
  );

  // A Claude session's conversation, by its session id, to read before picking it up here; the same shape
  // as a session's chat. Only a transcript under Claude Code's projects folder is read.
  app.get<{ Params: { sid: string }; Querystring: { from?: string; before?: string; sid?: string } }>(
    '/api/claude/sessions/:sid/chat',
    async (req, reply) => {
      const { sid } = req.params;
      const path = deps.claudeProjectsRoot ? await findTranscript(deps.claudeProjectsRoot, sid) : null;
      if (!path) return reply.code(404).send({ error: 'no such conversation' });
      const from = Number(req.query.from ?? 0);
      const before = req.query.before === undefined ? null : Number(req.query.before);
      if (!Number.isSafeInteger(from) || from < 0) return reply.code(400).send({ error: 'bad from' });
      if (before !== null && (!Number.isSafeInteger(before) || before < 0)) return reply.code(400).send({ error: 'bad before' });
      if (req.query.sid !== sid) return { sid, ...(await readChat(path, 0)) };
      return { sid, ...(await (before === null ? readChat(path, from) : readChatBefore(path, before))) };
    },
  );

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
