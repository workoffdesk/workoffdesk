import type { ClaudeEvent } from './claude/transcript/events.js';
import type { CodexEvent } from './codex/events.js';

// What either agent wrote down of a conversation, as one event whose kind names the agent (`claude:prompt`,
// `codex:userMessage`). Each agent's events are made in its own events.ts, from its own records only.
export type AgentEvent = ClaudeEvent | CodexEvent;

// For a switch over every kind: a kind no case handles leaves this called with it, which does not compile.
export function unhandled(e: never): never {
  throw new Error(`agent event not handled: ${JSON.stringify(e)}`);
}
