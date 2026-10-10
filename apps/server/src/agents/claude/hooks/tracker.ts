import { askedOf, leftToScreen, type HeldHook, type PermissionPayload } from './asks.js';
import type { HookPayload } from './hooks.js';
import { heldInTranscript, lastTurn, transcriptTail } from '../transcript/turn.js';
import { nextStatus, notificationFor, type PushEvent } from './status.js';
import { shownTitle, type SessionMeta } from '../../../system/store.js';
import type { ClaudeStatus } from '../../types.js';

// said: what the event was about in Claude's words (the reply that ended the turn, what it asks), or nothing.
export type Notifier = { notify(sessionId: string, title: string, event: PushEvent, said: string): Promise<void> };

// How long a turn that ended with a message still in Claude's own queue waits for Claude to start the turn
// that message makes, before it is taken as over after all.
export const HELD_WAIT_MS = 5000;

// Hook events after which no permission prompt of the session is still open, and those that say its tool ran.
const ASKS_OVER = new Set(['UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd']);
const TOOL_DONE = new Set(['PostToolUse', 'PostToolUseFailure']);

// What the hooks need of the machine whose sessions they report on.
export type TrackerHost = {
  sessionMeta(id: string): SessionMeta | undefined;
  getStatus(id: string): ClaudeStatus | null;
  setStatus(id: string, status: ClaudeStatus): void;
  holdPermission(id: string, payload: PermissionPayload, hook: HeldHook): boolean;
  setClaudeSessionId(id: string, claudeSessionId: string): void;
  ingest(id: string): Promise<void>;
  claudeMayHaveQuit(id: string): void;
  compactStarted(id: string): void;
  compactEnded(id: string, manual: boolean): void;
  asks: { toolDone(termId: string, tool: unknown, input: unknown): void; endAll(termId: string): void };
};

function mover(machine: TrackerHost, notifier: Notifier) {
  return (termId: string, event: string, type?: string, said = '') => {
    const meta = machine.sessionMeta(termId);
    if (!meta) return;
    const prev = machine.getStatus(termId);
    const next = nextStatus(prev, event, type);
    if (!next || next === prev) return;
    machine.setStatus(termId, next);
    const n = notificationFor(prev, next, shownTitle(meta));
    if (n) void notifier.notify(termId, n.title, n.event, said).catch(() => {});
  };
}

// A permission prompt is a wait from the moment its hook comes, seconds before Claude Code's notification,
// which says only that one is open.
export function createPermissionHandler(machine: TrackerHost, notifier: Notifier) {
  const move = mover(machine, notifier);
  return (termId: string, payload: PermissionPayload, hook: HeldHook) => {
    if (machine.holdPermission(termId, payload, hook) || leftToScreen(payload)) move(termId, 'Notification', 'permission_prompt', askedOf(payload));
  };
}

// What a hook's event was about, in Claude's words: the reply a turn ended with, or what an MCP server asks.
// Claude Code's own notification of a prompt names no more than that one is open.
function saidIn(payload: HookPayload, event: string): string {
  const said = event === 'Notification' ? (payload.notification_type === 'elicitation_dialog' ? payload.message : '') : payload.last_assistant_message;
  return typeof said === 'string' ? said : '';
}

export function createHookHandler(machine: TrackerHost, notifier: Notifier) {
  const held = new Map<string, ReturnType<typeof setTimeout>>();
  const move = mover(machine, notifier);

  return (termId: string, payload: HookPayload) => {
    if (!machine.sessionMeta(termId)) return;
    if (typeof payload.session_id === 'string') machine.setClaudeSessionId(termId, payload.session_id);
    void machine.ingest(termId);
    const event = String(payload.hook_event_name ?? '');
    if (TOOL_DONE.has(event)) machine.asks.toolDone(termId, payload.tool_name, payload.tool_input);
    if (ASKS_OVER.has(event)) machine.asks.endAll(termId);
    clearTimeout(held.get(termId));
    held.delete(termId);
    if (event === 'SessionEnd') return machine.claudeMayHaveQuit(termId);
    if (event === 'PreCompact') return machine.compactStarted(termId);
    if (event === 'PostCompact') return machine.compactEnded(termId, payload.trigger === 'manual');
    // Claude goes on at once with what was typed into its own queue while it worked (a message sent now,
    // out of its turn), however the turn ended: it is not over, and what waits here waits for the next.
    const ended = event === 'Stop' || event === 'StopFailure';
    if (ended && typeof payload.transcript_path === 'string' && heldInTranscript(payload.transcript_path).length > 0) {
      held.set(
        termId,
        setTimeout(() => {
          held.delete(termId);
          // Started with no hook to say so: the next Stop ends it.
          const lines = transcriptTail(payload.transcript_path as string);
          if (lines && lastTurn(lines)?.over === false) return;
          move(termId, event, undefined, saidIn(payload, event));
        }, HELD_WAIT_MS),
      );
      return;
    }
    move(termId, event, typeof payload.notification_type === 'string' ? payload.notification_type : undefined, saidIn(payload, event));
  };
}
