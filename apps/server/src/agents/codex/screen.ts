import { parseChoices, type Choices } from '../claude/screen/choices.js';

// What Codex's TUI asks before its thread starts (trust this folder?), read off the screen as Claude Code's
// choices are: the same numbered list, its current option marked › rather than ❯. Only before: once a thread
// runs, the messages sent are drawn after a › too, and what Codex asks comes from its app server.
export const codexChoices = (screen: string): Choices | null => parseChoices(screen.replace(/›/g, '❯'));
