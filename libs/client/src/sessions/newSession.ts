import { t } from '@workoffdesk/i18n';
import { agentOf, ApiError, MACHINE, type Agent, type Api, type RecentConversation, type TermSession } from '../base/api';

// A Claude to start in a folder: new, or picking up a conversation from this Mac by its id.
export type NewClaude = { kind: 'claude'; cwd: string; resumeId?: string; title?: string };
// The same for Codex: new, or going on with a thread by its id.
export type NewCodex = { kind: 'codex'; cwd: string; resumeId?: string; title?: string };
export type NewAgent = NewClaude | NewCodex;

export const createSession = (api: Api, spec: NewAgent) => api<TermSession>(`/api/m/${MACHINE}/sessions`, { method: 'POST', json: spec });

// Whether this Mac can start a Codex as well as a Claude.
export const agentsOn = (api: Api) => api<{ codex: boolean }>(`/api/m/${MACHINE}/agents`);

// Where going on with an ended session's conversation leads: the session it goes on in, or, when the conversation
// is open in a terminal on the Mac, its page there, to take it over from.
export type GoneOn = { session: TermSession } | { onMac: { agent: Agent; sid: string } };

// The conversation of a session whose agent is gone goes on: in that session while the Mac still has it (its
// Claude quit, `inPlace`, or it is kept as past), in a new one once it is gone from there.
export async function goOnWith(api: Api, s: TermSession & { kind: Agent }, inPlace: boolean): Promise<GoneOn> {
  const sid = s.kind === 'codex' ? s.codexThreadId : s.claudeSessionId;
  try {
    const session = inPlace || s.past
      ? await api<TermSession>(`/api/m/${MACHINE}/sessions/${s.id}/continue`, { method: 'POST' })
      : await createSession(api, { kind: s.kind, cwd: s.cwd, resumeId: sid });
    return { session };
  } catch (e) {
    if (sid && e instanceof ApiError && e.code === 'open-on-mac') return { onMac: { agent: s.kind, sid } };
    throw e;
  }
}

// Whether an ended session's conversation can be gone on with: it has one to go on with.
export const canGoOn = (s: TermSession) => !!(s.kind === 'codex' ? s.codexThreadId : s.claudeSessionId);

// The Claude and Codex conversations people had on this Mac, newest first; only the Claude ones from a
// server older than the Codex ones.
export const recentConversations = (api: Api) =>
  api<RecentConversation[]>('/api/recent').catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) return api<RecentConversation[]>('/api/claude/recent');
    throw e;
  });

// Where a conversation on the Mac is read before it is gone on with here.
export const previewChatUrl = (agent: Agent, id: string) =>
  agent === 'codex' ? `/api/codex/threads/${id}/chat` : `/api/claude/sessions/${id}/chat`;

// The recent conversations a search finds, those people had apart from those programs started; one with no
// folder cannot be started again.
export function recentFound(all: RecentConversation[], query: string): { people: RecentConversation[]; programs: RecentConversation[] } {
  const needle = query.trim().toLowerCase();
  const shown = all.filter((r) => r.cwd && (!needle || `${r.title} ${r.cwd}`.toLowerCase().includes(needle)));
  return { people: shown.filter((r) => !r.automated), programs: shown.filter((r) => r.automated) };
}

// What a row in the list of recent conversations says before its time and folder: the agent when it is not
// Claude, and why it cannot be resumed here, if so.
export function recentNote(r: RecentConversation): string {
  const codex = agentOf(r) === 'codex';
  return `${codex ? 'Codex · ' : ''}${r.openIn ? t.alreadyOpen : r.folderGone ? t.folderGoneShort : r.background ? (codex ? t.openElsewhere : t.inBackground) : ''}`;
}

// One held where it cannot be gone on with here (a Claude background session, another Codex app), or whose
// folder is gone, cannot be resumed here, unless it is already open here.
export const canPickUp = (r: RecentConversation) => !!r.openIn || (!r.background && !r.folderGone);

// What picking up a conversation from the Mac's list does: open the session already here, nothing (a
// background session holds it, or its folder is gone), resume it, or take it over from the terminals on the Mac
// it is open in.
export type PickUp =
  | { do: 'open'; id: string }
  | { do: 'none' }
  | { do: 'gone' }
  | { do: 'resume' }
  | { do: 'takeOver'; status: 'idle' | 'busy' | 'waiting'; terminals: number; waiting: boolean };

export function pickUpOf(r: RecentConversation): PickUp {
  if (r.openIn) return { do: 'open', id: r.openIn };
  if (r.folderGone) return { do: 'gone' };
  if (r.background) return { do: 'none' };
  if (!r.onMac) return { do: 'resume' };
  return { do: 'takeOver', status: r.onMac.status, terminals: r.onMac.terminals, waiting: !!r.takingOver };
}

// A conversation open in a terminal on the Mac, gone on with here: the agent there is quit now (what it was
// writing in a turn is lost), or once it is idle. The session, or null while it is waited on.
export async function takeOver(api: Api, r: RecentConversation & { cwd: string }, when: 'now' | 'whenIdle'): Promise<TermSession | null> {
  const made = await api<TermSession | { waiting: true }>(`/api/m/${MACHINE}/sessions`, {
    method: 'POST',
    json: { kind: agentOf(r), cwd: r.cwd, resumeId: r.sessionId, takeOver: when },
  });
  return 'waiting' in made ? null : made;
}

export const cancelTakeOver = (api: Api, r: RecentConversation) =>
  api<void>(agentOf(r) === 'codex' ? `/api/codex/threads/${r.sessionId}/take-over` : `/api/claude/sessions/${r.sessionId}/take-over`, { method: 'DELETE' });

// What the person types at the Mac to go on there with a session of workoffdesk's.
export const attachCommand = (id: string) => `workoffdesk attach ${id}`;
