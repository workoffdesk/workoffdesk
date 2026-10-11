import { basename } from 'node:path';
import type { ClaudeAccounts } from '../../agents/claude/accounts.js';
import type { PermissionAsks } from '../../agents/claude/hooks/asks.js';
import type { ClaudeScreen } from '../../agents/claude/screen/screen.js';
import type { Usage } from '../../agents/claude/usage.js';
import type { CodexAgent } from '../../agents/codex/agent.js';
import type { CodexThreads } from '../../agents/codex/threads.js';
import type { ClaudeStatus } from '../../agents/types.js';
import type { Journal } from '../../journal/index.js';
import { InvalidRequest } from '../../system/errors.js';
import type { SessionMeta, State, Store } from '../../system/store.js';
import type { Tmux } from '../../system/tmux.js';
import type { Outbox } from '../outbox.js';
import type { Accounts } from './accounts.js';
import type { Input } from './input.js';
import type { Lifecycle } from './lifecycle.js';
import type { Moves } from './moves.js';
import type { Naming } from './naming.js';
import type { TakeOvers } from './takeOvers.js';
import type { Status } from './status.js';
import type { StatusNotifier, TermSession } from './types.js';

// Wide and tall enough that a dialog's lines and a list of options are read whole.
export const CHAT_SIZE = { cols: 100, rows: 50 };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ID = /^[a-z0-9]{1,32}$/;

// As much of a name as a row of the session list has room for.
const TITLE_MAX = 40;

// A name on one line, in characters rather than UTF-16 units; empty for none.
export const nameLine = (name: string | undefined) => [...(name ?? '').replace(/[\s\p{Cc}]+/gu, ' ').trim()].slice(0, TITLE_MAX).join('').trimEnd();

// A session's name; none is the directory's name.
export function sessionTitle(name: string | undefined, cwd: string): string {
  return nameLine(name) || basename(cwd) || cwd;
}

// The names of the latest conversations named are kept; a name given again counts as the latest.
const CLAUDE_NAMES_KEPT = 200;

export function nameConversation(st: State, claudeSessionId: string, name: string): void {
  delete st.claudeNames[claudeSessionId];
  if (name) st.claudeNames[claudeSessionId] = name;
  const names = Object.keys(st.claudeNames);
  for (const old of names.slice(0, Math.max(0, names.length - CLAUDE_NAMES_KEPT))) delete st.claudeNames[old];
}

// What more than one of the machine's parts reads or changes, per session, and who is told of a change.
export class MachineState {
  readonly statuses = new Map<string, ClaudeStatus>();
  readonly usages = new Map<string, Usage>();
  // Sessions waiting on a choice only the screen shows, and the status they had before it.
  readonly screenWaits = new Map<string, ClaudeStatus>();
  // When each session's conversation was last looked for on the Mac.
  readonly macLooks = new Map<string, number>();
  // Per Claude session, the watch on its transcript that takes what is added into the journal.
  readonly transcriptWatches = new Map<string, () => void>();
  // Per Claude conversation, the session being started to go on with it: asked again meanwhile, the same one.
  readonly resuming = new Map<string, Promise<TermSession>>();
  readonly listeners = new Set<() => void>();
  notifier: StatusNotifier | null = null;
  // What the machine is to do later; null once the journal is closed, when nothing is.
  private timers: Set<NodeJS.Timeout> | null = new Set();

  emit(): void {
    for (const cb of this.listeners) cb();
  }

  // Runs f in ms, unless the journal is closed first; the function returned stops it sooner.
  later(ms: number, f: () => void): () => void {
    const timers = this.timers;
    if (!timers) return () => {};
    const timer = setTimeout(() => {
      timers.delete(timer);
      f();
    }, ms).unref();
    timers.add(timer);
    return () => {
      clearTimeout(timer);
      timers.delete(timer);
    };
  }

  // With the journal closed: what was to be done later is not, and nothing more is.
  stopTimers(): void {
    for (const timer of this.timers ?? []) clearTimeout(timer);
    this.timers = null;
  }
}

// What the machine's parts work with and never replace.
export type MachineDeps = Readonly<{
  tmux: Tmux;
  claude: ClaudeScreen;
  store: Store;
  journal: Journal;
  outbox: Outbox;
  asks: PermissionAsks;
  // Codex sessions, through the app server their TUIs run on; none when Codex is not set up.
  codex: CodexAgent | null;
  codexThreads: CodexThreads | null;
  accounts: ClaudeAccounts | null;
  claudeSettingsPath: string;
  claudeBin: string;
  shell: string;
  claudeArgs: string[];
  claudeProjectsRoot: string | undefined;
}>;

// What the parts ask of the machine itself.
export type Sessions = {
  listSessions(): Promise<TermSession[]>;
  toSession(id: string, meta: SessionMeta, lastActivity: number): TermSession;
  ingest(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
};

export type Parts = { sessions: Sessions; lifecycle: Lifecycle; input: Input; status: Status; accounts: Accounts; moves: Moves; naming: Naming; takeOvers: TakeOvers };

export function codexOf(d: MachineDeps): CodexAgent {
  if (!d.codex) throw new InvalidRequest('Codex is not set up on this Mac');
  return d.codex;
}

// The conversation a session holds, Claude's or Codex's.
export const conversationOf = (s: { claudeSessionId?: string; codexThreadId?: string }) => s.claudeSessionId ?? s.codexThreadId;
