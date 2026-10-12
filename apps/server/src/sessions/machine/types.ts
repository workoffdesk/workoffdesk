import type { Choices } from '../../agents/claude/screen/choices.js';
import type { ScreenRead } from '../../agents/claude/screen/screen.js';
import type { PushEvent } from '../../agents/claude/hooks/status.js';
import type { MacOpen } from '../../agents/claude/terminals.js';
import type { Usage } from '../../agents/claude/usage.js';
import type { Entry } from '../../agents/codex/items.js';
import type { CodexOnMac } from '../../agents/codex/threads.js';
import type { Answer, Ask, ClaudeStatus } from '../../agents/types.js';
import type { SessionKind } from '../../system/store.js';
import type { Queued } from '../outbox.js';

export type { ClaudeStatus } from '../../agents/types.js';

// What the session waits on and what its screen holds for the chat. asks: what it waits on the person
// for, as Claude Code itself said it; the screen's choices may show the same prompt again.
export type OnScreen = ScreenRead & { asks: Ask[] };

export type CreateSpec =
  | { kind: 'shell'; cwd?: string; title?: string }
  // takeOver: a conversation open in a terminal on the Mac is quit there first, to go on here. env: the
  // environment of the terminal it is opened for; one taken over keeps the environment it had there.
  | { kind: 'claude'; cwd: string; resumeId?: string; title?: string; takeOver?: boolean; env?: Record<string, string> }
  // resumeId: a Codex thread to go on with; takeOver as for Claude.
  | { kind: 'codex'; cwd: string; resumeId?: string; title?: string; takeOver?: boolean };

// A conversation of Claude's or a thread of Codex's, gone on with here.
// When a session moves to another account: now, interrupting what is at work; or once it is free.
export type MoveWhen = 'now' | 'free';

export type ConversationResume = { kind: 'claude' | 'codex'; cwd: string; resumeId: string; title?: string };

export type TermSession = {
  id: string;
  title: string;
  kind: SessionKind;
  cwd: string;
  claudeSessionId?: string;
  codexThreadId?: string;
  createdAt: number;
  lastActivity: number;
  status: ClaudeStatus | null;
  // As Claude Code's status line last reported it; null until it has.
  usage: Usage | null;
  // The Claude account it runs on, by its email; said only on a Mac with more than one.
  claudeAccount?: string;
  // Gone from tmux and kept, to read and go on with, until deleted.
  past?: true;
  // The main folder of the git repository it is in, a worktree's too; missing outside git.
  project?: string;
  // When it was pinned to the top of the list, in ms.
  pinned?: number;
};

export interface Machine {
  readonly id: string;
  listSessions(): Promise<TermSession[]>;
  createSession(spec: CreateSpec): Promise<TermSession>;
  // The Claude conversations open in a terminal on this Mac outside every WorkOffDesk on it, by conversation id.
  openOnMac(recentMs?: number): Promise<Map<string, MacOpen>>;
  // Quits each Claude in a terminal on the Mac that holds the session's conversation too; unless force, none while
  // one there is at work or asking.
  quitOnMac(id: string, force?: boolean): Promise<void>;
  // The Codex conversations people had on this Mac, and where each is open now; none without Codex.
  codexOnMac(): Promise<CodexOnMac[]>;
  // A Codex thread's conversation so far, read without opening it.
  codexChat(threadId: string): Promise<Entry[]>;
  // Takes a conversation over from the Mac once it is idle there: at once when it is (the session started),
  // or later (null), while takingOver says so.
  takeOverWhenIdle(spec: ConversationResume): Promise<TermSession | null>;
  takingOver(claudeSessionId: string): boolean;
  // False when none was waiting.
  cancelTakeOver(claudeSessionId: string): boolean;
  // Goes on with the conversation of a Claude session whose Claude quit, in that session; one whose Claude runs is
  // answered as it is.
  continueSession(id: string): Promise<TermSession>;
  // The session moved to the Claude account in use, or refused saying why: when it is free now (none given), now
  // whatever is at work, or once it is free (answered at once, marked moving).
  moveThis(id: string, when?: MoveWhen): Promise<TermSession>;
  killSession(id: string): Promise<void>;
  // Gives the session a name of its own; an empty one is the directory's name again. Null when it is gone.
  renameSession(id: string, title: string): Promise<TermSession | null>;
  // Pins a session, running or past, or unpins it; false when there is no such session.
  pinSession(id: string, on: boolean): Promise<boolean>;
  // The name a session here was last given while it held this Claude conversation; null when none was.
  claudeName(claudeSessionId: string): string | null;
  // What was typed on the phone, to the program as a keyboard would give it.
  type(id: string, text: string): Promise<void>;
  // A message for Claude: it goes now, or waits, in order, until Claude can take it. Null when it went.
  sendMessage(id: string, text: string, qid?: string): Promise<Queued | null>;
  // Takes back a message still waiting; its text, or null when it already went.
  unsend(id: string, queuedId: string): string | null;
  // Sends a waiting message now, whatever Claude is doing; false when it is no longer waiting.
  sendNow(id: string, queuedId: string): Promise<boolean>;
  // Moves a waiting message one place earlier or later; false when it is no longer waiting.
  moveQueued(id: string, queuedId: string, by: -1 | 1): boolean;
  // Types a slash command at Claude's prompt; false when a dialog has the keyboard instead.
  // ran false: a dialog had the keyboard and nothing was typed. screen: what was on screen once the command's
  // dialog showed, or when it had not after a while.
  runCommand(id: string, command: string): Promise<{ ran: boolean; screen: OnScreen | null }>;
  // Keys pressed in what is on screen (a dialog's slider, its Esc), as a keyboard would give them: what the
  // screen holds once it has changed, or after a while when it has not.
  press(id: string, keys: string): Promise<OnScreen>;
  // Closes the dialog of Claude Code's on screen, with as many Esc as it takes and none after: the screen then.
  close(id: string): Promise<OnScreen>;
  // Puts the session at the size the chat reads its screen at, unless a terminal on the Mac is showing it.
  fitForChat(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
  // The choice the session's program is asking for on screen, if any.
  choices(id: string): Promise<Choices | null>;
  // What the session's screen holds for the chat: a choice asked for, a dialog open over the prompt.
  onScreen(id: string): Promise<OnScreen>;
  // The screen as plain text, for what the chat cannot make out.
  screenText(id: string): Promise<string>;
  // Takes option `index` if it is still `label` on screen; false when the screen has moved on.
  choose(id: string, index: number, label: string, text?: string): Promise<boolean>;
  tick(id: string, ticked: number[], labels: string[]): Promise<boolean>;
  // Answers one of the session's asks; false when it is over (answered at the Mac, or the turn moved on).
  answer(id: string, askId: string, answer: Answer): boolean;
  onChange(cb: () => void): () => void;
}

// How much of what scrolled off the top a look at the screen takes along, to scroll back through.
export const SCREEN_HISTORY = 500;

// Told when a session's status changes in a way the person is told of (push.ts), with what it was about.
export type StatusNotifier = { notify(sessionId: string, title: string, event: PushEvent, said: string): Promise<void> };
