import { unhandled, type AgentEvent } from './events.js';

// What an event, of either agent, says of the turn: that one begins with it, that it goes on, that it ended there, or nothing.
export function turnSays(e: AgentEvent): 'starts' | 'going' | 'over' | null {
  switch (e.k) {
    case 'claude:prompt':
    case 'claude:shell':
    case 'claude:shellOutput':
    case 'claude:teammates':
    case 'claude:taskNotification':
    case 'claude:fromOther':
      return 'starts';
    case 'claude:command':
      return e.local ? null : 'starts';
    case 'claude:results':
    case 'claude:reply':
      return 'going';
    case 'claude:queue':
      return e.op === 'dequeue' ? 'going' : null;
    case 'claude:interrupted':
    case 'claude:apiError':
    case 'claude:turnOver':
      return 'over';
    // A compaction asked for runs between turns; one Claude Code starts on its own can fall in the middle of one.
    case 'claude:compactBoundary':
      return e.manual ? 'over' : null;
    case 'claude:commandOutput':
    case 'claude:compacted':
    case 'claude:noted':
    case 'claude:peer':
    case 'claude:midTurnPrompt':
    case 'claude:midTurnTaskEnd':
    case 'claude:title':
    case 'claude:lastPrompt':
    case 'claude:sidechain':
    case 'claude:other':
      return null;
    // Codex marks its turns itself; what is said inside one says nothing more of it.
    case 'codex:rolloutTurnStarted':
      return 'starts';
    case 'codex:rolloutTurnEnded':
    case 'codex:turnEnded':
      return 'over';
    case 'codex:rolloutPrompt':
    case 'codex:userMessage':
    case 'codex:agentMessage':
    case 'codex:plan':
    case 'codex:commandExecution':
    case 'codex:fileChange':
    case 'codex:toolCall':
    case 'codex:webSearch':
    case 'codex:imageView':
    case 'codex:compaction':
    case 'codex:other':
      return null;
    default:
      return unhandled(e);
  }
}
