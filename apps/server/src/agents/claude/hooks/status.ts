import type { ClaudeStatus } from '../../types.js';

const TRANSITIONS: Record<string, ClaudeStatus> = {
  UserPromptSubmit: 'working',
  PostToolUse: 'working',
  PostToolUseFailure: 'working',
  Notification: 'waiting',
  Stop: 'idle',
  // A turn ended by an API error, a rate limit or an overload.
  StopFailure: 'idle',
};

// SessionStart says which transcript Claude writes from now on, and that a new one is at its prompt. A compaction's status
// depends on what came before it, so the machine keeps it. SessionEnd comes on /clear too, while Claude goes on: whether
// Claude ended is read off its process (machine.ts), which the hook only has looked at sooner.
export const HOOK_EVENTS = [...Object.keys(TRANSITIONS), 'SessionStart', 'SessionEnd', 'PreCompact', 'PostCompact'];

// Notifications that wait on the user: a permission prompt (which is also how a question from Claude
// shows) and an MCP server asking for input. Claude also notifies when idle at its prompt for a minute,
// which is not a wait; one without a type comes from a version that predates the types.
const ASKS = new Set(['permission_prompt', 'elicitation_dialog']);

export function nextStatus(prev: ClaudeStatus | null, event: string, notificationType?: string): ClaudeStatus | null {
  if (event === 'Notification' && notificationType !== undefined && !ASKS.has(notificationType)) return prev;
  // Asked something before it started (trust this folder?), it starts once that is answered.
  if (event === 'SessionStart') return prev === 'starting' || prev === 'waiting' ? 'idle' : prev;
  return TRANSITIONS[event] ?? prev;
}

// What a push says happened, put into words by the phone in its own language.
export type PushEvent = 'waiting' | 'idle';

export function notificationFor(prev: ClaudeStatus | null, next: ClaudeStatus | null, title: string): { title: string; event: PushEvent } | null {
  if (!next || prev === next) return null;
  if (next === 'waiting') return { title, event: 'waiting' };
  if (next === 'idle' && prev === 'working') return { title, event: 'idle' };
  return null;
}
