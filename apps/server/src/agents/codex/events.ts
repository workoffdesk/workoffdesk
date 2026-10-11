// What Codex writes down of a conversation, as events, decided here and nowhere else: its app server's items
// and turns (the protocol is marked experimental, every field may be missing) and the lines of its rollout
// files. Each source has its own translator: the app server's items are camelCase, the rollout's PascalCase.

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// One file of a change, at its place in the item: a change with no path keeps its place.
export type FileChange = { path: string; kind: string; diff: string };

// What the app server gives of a thread: its items, and its turns once ended. Each carries the id the chat keys it by.
export type CodexThreadEvent = { at?: string } & (
  // What the person typed, its text parts on lines of their own; clientId: the phone's id for it, if it sent it.
  | { k: 'codex:userMessage'; id: string; text: string; clientId: string }
  | { k: 'codex:agentMessage'; id: string; text: string }
  | { k: 'codex:plan'; id: string; text: string }
  // command: as Codex parsed it, else the shell line that wraps it.
  | { k: 'codex:commandExecution'; id: string; command: string; output: string; status: string; exitCode?: number }
  | { k: 'codex:fileChange'; id: string; status: string; changes: FileChange[] }
  // Another program's tool (MCP) or one the client gave (dynamic). text: why it failed, else what it gave back.
  | { k: 'codex:toolCall'; id: string; name: string; args: Obj; text: string; failed: boolean }
  | { k: 'codex:webSearch'; id: string; query: string }
  | { k: 'codex:imageView'; id: string; path: string }
  | { k: 'codex:compaction'; id: string }
  | { k: 'codex:turnEnded'; id: string; how: 'completed' | 'interrupted' | 'failed'; error: string }
  | { k: 'codex:other' }
);

// What a rollout file says, read for how its last turn went and what the person said last. Its lines name
// nothing the chat could key an entry by, so they are kinds of their own, which the chat does not take.
export type CodexRolloutEvent = { at?: string } & (
  | { k: 'codex:rolloutTurnStarted' }
  // aborted: turn_aborted, which is not always the person stopping it.
  | { k: 'codex:rolloutTurnEnded'; how: 'completed' | 'aborted' }
  | { k: 'codex:rolloutPrompt'; text: string }
  | { k: 'codex:other' }
);

export type CodexEvent = CodexThreadEvent | CodexRolloutEvent;

const other = (): { k: 'codex:other' } => ({ k: 'codex:other' });

// The command of a command execution or of an approval to run one: as Codex parsed it rather than the shell
// line that wraps it (`/bin/zsh -c '…'`).
export const commandOf = (o: Obj) => str(obj(arr(o.commandActions)[0])?.command) || str(o.command);

const textParts = (content: unknown) =>
  arr(content)
    .map((c) => (obj(c)?.type === 'text' ? str(obj(c)?.text) : ''))
    .filter(Boolean)
    .join('\n');

function itemKind(i: Obj, id: string): CodexThreadEvent {
  switch (i.type) {
    case 'userMessage':
      return { k: 'codex:userMessage', id, text: textParts(i.content), clientId: str(i.clientId) };
    case 'agentMessage':
      return { k: 'codex:agentMessage', id, text: str(i.text) };
    case 'plan':
      return { k: 'codex:plan', id, text: str(i.text) };
    case 'commandExecution': {
      const exitCode = num(i.exitCode);
      return { k: 'codex:commandExecution', id, command: commandOf(i), output: str(i.aggregatedOutput), status: str(i.status), ...(exitCode !== undefined && { exitCode }) };
    }
    case 'fileChange':
      return {
        k: 'codex:fileChange',
        id,
        status: str(i.status),
        changes: arr(i.changes).map((c) => ({ path: str(obj(c)?.path), kind: str(obj(obj(c)?.kind)?.type), diff: str(obj(c)?.diff) })),
      };
    case 'mcpToolCall':
    case 'dynamicToolCall': {
      const error = str(obj(i.error)?.message);
      const given = arr(obj(i.result)?.content ?? i.contentItems).map((c) => str(obj(c)?.text)).filter(Boolean).join('\n');
      return {
        k: 'codex:toolCall',
        id,
        name: [str(i.server) || str(i.namespace), str(i.tool)].filter(Boolean).join('.'),
        args: obj(i.arguments) ?? {},
        text: error || given,
        failed: !!error || str(i.status) === 'failed' || i.success === false,
      };
    }
    case 'webSearch':
      return { k: 'codex:webSearch', id, query: str(i.query) };
    case 'imageView':
      return { k: 'codex:imageView', id, path: str(i.path) };
    case 'contextCompaction':
      return { k: 'codex:compaction', id };
    default:
      return other();
  }
}

// An item of a thread, as the app server gives it; at: when it started or completed, as the caller knows.
export function itemEventOf(item: unknown, at?: string): CodexThreadEvent {
  const i = obj(item);
  const id = str(i?.id);
  if (!i || !id) return other();
  const event = itemKind(i, id);
  return at && event.k !== 'codex:other' ? { ...event, at } : event;
}

// A turn as the app server gives it: an event once it has ended.
export function turnEventOf(turn: unknown): CodexThreadEvent {
  const t = obj(turn);
  const id = str(t?.id);
  if (!t || !id) return other();
  const ended = (how: 'completed' | 'interrupted' | 'failed') => ({ k: 'codex:turnEnded' as const, id, how, error: str(obj(t.error)?.message) });
  switch (t.status) {
    case 'completed':
    case 'interrupted':
    case 'failed':
      return ended(t.status);
    default:
      return other();
  }
}

// A line of a rollout file, once parsed.
export function rolloutEventOf(line: unknown): CodexRolloutEvent {
  const e = obj(line);
  const p = obj(e?.payload);
  if (!e || e.type !== 'event_msg' || !p) return other();
  const at = typeof e.timestamp === 'string' ? { at: e.timestamp } : {};
  switch (p.type) {
    case 'task_started':
      return { k: 'codex:rolloutTurnStarted', ...at };
    case 'task_complete':
      return { k: 'codex:rolloutTurnEnded', how: 'completed', ...at };
    case 'turn_aborted':
      return { k: 'codex:rolloutTurnEnded', how: 'aborted', ...at };
    case 'item_completed': {
      const item = obj(p.item);
      return item?.type === 'UserMessage' ? { k: 'codex:rolloutPrompt', text: textParts(item.content), ...at } : other();
    }
    // How Codex before September wrote it.
    case 'user_message':
      return { k: 'codex:rolloutPrompt', text: str(p.message), ...at };
    default:
      return other();
  }
}
