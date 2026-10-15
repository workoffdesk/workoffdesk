import { isOwnHookCommand } from '../hooks/hooks.js';
import { eventOf, tagText, type ReplyBlock, type ToolResult, type ClaudeEvent } from './events.js';
import { unhandled } from '../../events.js';

// A Claude session as a conversation, read from its transcript's events.

export type ChatItem =
  | { k: 'user'; text: string; at?: string }
  | { k: 'text'; text: string; at?: string }
  // input: what it was asked to do, whole, when summary says less.
  | { k: 'tool'; id: string; name: string; summary: string; input?: string; at?: string; plan?: string }
  // stopped: the call never ran; Claude Code was stopped (Esc) before it did.
  | { k: 'result'; id: string; text: string; error: boolean; stopped?: true; image?: true; diff?: Diff }
  // A line between the turns: text as it is in the transcript, or an event the phone puts in its own words.
  // command: a command typed at Claude's prompt (`/exit`), which is what a message of those words became.
  | { k: 'note'; text: string; detail?: string; retry?: true; command?: true; at?: string }
  | { k: 'note'; event: NoteEvent; detail?: string; retry?: true }
  // Claude's task list: a task made or changed (TaskCreate, TaskUpdate), or the whole list at once (TodoWrite).
  | { k: 'task'; id: string; subject?: string; status?: string }
  | { k: 'todos'; items: { subject: string; status: string }[] }
  // A command Claude runs in the background: started by the tool call `tool`, then completed, failed or killed.
  | { k: 'bg'; id: string; tool?: string; status: string };

export type NoteEvent =
  | { e: 'compacted' }
  | { e: 'interrupted' }
  // limit: the account hit a usage limit, which another account does not share.
  | { e: 'failed'; limit?: true }
  | { e: 'task'; status: string; what: string }
  | { e: 'peer'; from: string };

// What a file tool changed: the lines around each change, ' ' kept, '-' gone, '+' come, as Claude Code worked
// them out. The counts are of every changed line; only the first DIFF_LINES_MAX lines are kept.
export type Hunk = { oldStart: number; newStart: number; lines: string[] };
export type Diff = { file: string; added: number; removed: number; created?: true; cut?: true; hunks: Hunk[] };

const SUMMARY_MAX = 200;
const DIFF_LINES_MAX = 300;
const DIFF_LINE_MAX = 400;
const RESULT_MAX = 2000;
const INPUT_MAX = 4000;
// What Claude Code records as the answer of a call it was stopped before running.
const STOPPED = /^The user doesn't want to (proceed with this tool use|take this action)/;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

// The text a call's summary is of, whole.
function toolSaid(name: string, input: Record<string, unknown>): string {
  const pick = (...keys: string[]) => keys.map((k) => str(input[k])).find(Boolean);
  const named = {
    Bash: () => pick('description', 'command'),
    Read: () => pick('file_path'),
    Edit: () => pick('file_path'),
    Write: () => pick('file_path'),
    NotebookEdit: () => pick('notebook_path'),
    Grep: () => pick('pattern'),
    Glob: () => pick('pattern'),
    WebFetch: () => pick('url'),
    WebSearch: () => pick('query'),
    Agent: () => pick('description', 'prompt'),
    Task: () => pick('description', 'prompt'),
  }[name];
  return named?.() ?? Object.values(input).map(str).find(Boolean) ?? '';
}

export const toolSummary = (name: string, input: Record<string, unknown>) => clip(toolSaid(name, input).split('\n')[0], SUMMARY_MAX);

// Where what a call was asked is not the text its summary is of.
const WHOLE: Record<string, string> = { Bash: 'command', Agent: 'prompt', Task: 'prompt' };

// What a call was asked to do, whole, when its summary says less.
function toolInput(name: string, input: Record<string, unknown>, summary: string): string | undefined {
  const whole = str(input[WHOLE[name]]) || toolSaid(name, input);
  return whole && whole !== summary ? clip(whole, INPUT_MAX) : undefined;
}

// What Claude Code prints after a command for each hook that ran, when the hook is workoffdesk's own.
const ownHookLine = (line: string) => {
  const ran = /^\w+ \[(.*)\] completed successfully$/.exec(line);
  return ran !== null && isOwnHookCommand(ran[1]);
};

// A task TaskCreate made: Claude Code gives it its id only in the result.
function taskMade(v: unknown): ChatItem | null {
  const task = v && typeof v === 'object' ? (v as { task?: unknown }).task : null;
  if (!task || typeof task !== 'object') return null;
  const t = task as Record<string, unknown>;
  return typeof t.id === 'string' && typeof t.subject === 'string' ? { k: 'task', id: t.id, subject: t.subject, status: 'pending' } : null;
}

// A command Claude ran in the background, or one the user sent there while it ran, or an agent it started
// there; each one's end comes as a task notification with this id.
function backgroundStarted(v: unknown, tool: string): ChatItem[] {
  const r = v && typeof v === 'object' ? (v as { backgroundTaskId?: unknown; status?: unknown; agentId?: unknown }) : {};
  const id = r.status === 'async_launched' ? r.agentId : r.backgroundTaskId;
  return typeof id === 'string' ? [{ k: 'bg', id, tool, status: 'running' }] : [];
}

// A change to the task list, from what Claude asked for.
function taskItems(name: string, input: Record<string, unknown>): ChatItem[] {
  if (name === 'TaskUpdate' && typeof input.taskId === 'string') {
    const item: ChatItem = { k: 'task', id: input.taskId };
    if (typeof input.subject === 'string') item.subject = input.subject;
    if (typeof input.status === 'string') item.status = input.status;
    return [item];
  }
  const stopped = name === 'TaskStop' ? input.task_id : name === 'KillShell' || name === 'KillBash' ? input.shell_id : undefined;
  if (typeof stopped === 'string') return [{ k: 'bg', id: stopped, status: 'killed' }];
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    const items = input.todos.flatMap((t) =>
      t && typeof t === 'object' && typeof t.content === 'string' && typeof t.status === 'string' ? [{ subject: t.content, status: t.status }] : [],
    );
    return [{ k: 'todos', items }];
  }
  return [];
}

// Claude Code records what a file tool changed beside its result, for the record's one result.
function fileChange(v: unknown): Diff | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  if (typeof t.filePath !== 'string' || !t.filePath) return null;
  const created = t.type === 'create' && typeof t.content === 'string';
  const hunks: Hunk[] = created
    ? [{ oldStart: 0, newStart: 1, lines: (t.content as string).replace(/\n$/, '').split('\n').map((l) => `+${l}`) }]
    : (Array.isArray(t.structuredPatch) ? t.structuredPatch : []).flatMap((h) =>
        h && typeof h === 'object' && Array.isArray(h.lines) && h.lines.every((l: unknown) => typeof l === 'string')
          ? [{ oldStart: Number(h.oldStart) || 0, newStart: Number(h.newStart) || 0, lines: h.lines as string[] }]
          : [],
      );
  const all = hunks.flatMap((h) => h.lines);
  const added = all.filter((l) => l.startsWith('+')).length;
  const removed = all.filter((l) => l.startsWith('-')).length;
  if (!added && !removed) return null;
  let room = DIFF_LINES_MAX;
  const kept = hunks
    .map((h) => {
      const lines = h.lines.slice(0, Math.max(0, room)).map((l) => clip(l, DIFF_LINE_MAX));
      room -= lines.length;
      return { ...h, lines };
    })
    .filter((h) => h.lines.length);
  return { file: t.filePath, added, removed, ...(created ? { created: true as const } : {}), ...(all.length > DIFF_LINES_MAX ? { cut: true as const } : {}), hunks: kept };
}

function resultItems(results: ToolResult[], detail: unknown): ChatItem[] {
  const alone = results.length === 1 && !results[0].error;
  const diff = alone ? fileChange(detail) : null;
  const made = alone ? taskMade(detail) : null;
  const shown = results.map((b): ChatItem => {
    if (STOPPED.test(b.text)) return { k: 'result', id: b.id, text: '', error: false, stopped: true };
    const item: ChatItem = { k: 'result', id: b.id, text: clip(b.text, RESULT_MAX), error: b.error };
    if (diff) item.diff = diff;
    return b.image ? { ...item, image: true } : item;
  });
  const started = results.length === 1 ? backgroundStarted(detail, results[0].id) : [];
  return [...shown, ...(made ? [made] : []), ...started];
}

// The words a message sent to Claude has when the transcript records it as this item: a prompt's, or a
// command's typed at the prompt. Null for anything a message cannot be.
export function sentWords(item: ChatItem): string | null {
  if (item.k === 'user') return item.text;
  return item.k === 'note' && 'command' in item && item.command ? item.text : null;
}

function taskNote(text: string): ChatItem[] {
  const summary = tagText(text, 'summary');
  const what = /^Background command "([\s\S]*)" (?:completed|failed|was stopped)/.exec(summary)?.[1] ?? summary;
  const status = tagText(text, 'status');
  const id = tagText(text, 'task-id');
  const note: ChatItem = { k: 'note', event: { e: 'task', status, what }, detail: summary };
  return id && status ? [note, { k: 'bg', id, status }] : [note];
}

// The plan Claude asks to go ahead with, shown whole rather than as a line: written into Claude Code's
// plans folder in plan mode, or given to ExitPlanMode itself by older versions.
const PLAN_FILE = /\/\.claude\/plans\/[^/]+\.md$/;
function planOf(name: string, input: Record<string, unknown>): string {
  if (name === 'ExitPlanMode') return str(input.plan).trim();
  if (name === 'Write' && PLAN_FILE.test(str(input.file_path))) return str(input.content).trim();
  return '';
}

function replyItems(blocks: ReplyBlock[], at: string | undefined): ChatItem[] {
  return blocks.flatMap((b): ChatItem[] => {
    if (b.type === 'text') return b.text.trim() ? [{ k: 'text', text: b.text.trim(), at }] : [];
    const name = b.name || 'Tool';
    const plan = planOf(name, b.input);
    const summary = toolSummary(name, b.input);
    const input = toolInput(name, b.input, summary);
    return [{ k: 'tool', id: b.id, name, summary, ...(input && { input }), at, ...(plan && { plan }) }, ...taskItems(name, b.input)];
  });
}

// What one transcript record shows in the conversation. Subagents' own turns, Claude's thinking and
// text injected for Claude alone are not part of it.
export function chatItems(v: unknown): ChatItem[] {
  return eventItems(eventOf(v));
}

function eventItems(e: ClaudeEvent): ChatItem[] {
  const at = e.at;
  switch (e.k) {
    case 'claude:prompt':
      return e.text ? [{ k: 'user', text: e.text, at }] : [];
    // A message sent while Claude worked, which it took in the middle of its turn.
    case 'claude:midTurnPrompt':
      return e.text ? [{ k: 'user', text: e.text, at }] : [];
    // How a background command ended, taken in mid-turn: only the end is kept, the note comes as its own prompt.
    case 'claude:midTurnTaskEnd':
      return taskNote(e.text).filter((i) => i.k === 'bg');
    case 'claude:command':
      return e.local || e.name === '/compact' ? [] : [{ k: 'note', text: [e.name, e.args].filter(Boolean).join(' '), command: true, at }];
    case 'claude:commandOutput': {
      if (e.local) return [];
      const shown = e.text.split('\n').filter((l) => !ownHookLine(l)).join('\n').trim();
      return shown ? [{ k: 'note', text: clip(shown, RESULT_MAX) }] : [];
    }
    case 'claude:shell':
      return [{ k: 'note', text: `!${e.command}`, command: true, at }];
    case 'claude:shellOutput':
      return e.text ? [{ k: 'note', text: clip(e.text, RESULT_MAX) }] : [];
    case 'claude:results':
      return resultItems(e.results, e.detail);
    case 'claude:interrupted':
      return [{ k: 'note', event: { e: 'interrupted' }, retry: true }];
    case 'claude:compacted':
      return [{ k: 'note', event: { e: 'compacted' } }];
    case 'claude:peer':
      return [{ k: 'note', event: { e: 'peer', from: e.from }, detail: e.body }];
    // A body that is a JSON object is a status update between agents (idle, shutting down), for Claude alone.
    case 'claude:teammates':
      return e.messages.flatMap((m): ChatItem[] => (m.body && !/^\{[\s\S]*\}$/.test(m.body) ? [{ k: 'note', event: { e: 'peer', from: m.from }, detail: m.body }] : []));
    case 'claude:taskNotification':
      return taskNote(e.text);
    case 'claude:fromOther':
      return e.text ? [{ k: 'note', text: clip(e.text, RESULT_MAX) }] : [];
    case 'claude:reply':
      return replyItems(e.blocks, at);
    // A reply the API failed to give: what Claude Code wrote in its place says why.
    case 'claude:apiError':
      return [{ k: 'note', event: e.limit ? { e: 'failed', limit: true } : { e: 'failed' }, detail: clip(e.text.replace(/^API Error:\s*/, ''), RESULT_MAX), retry: true }];
    case 'claude:noted':
    case 'claude:compactBoundary':
    case 'claude:turnOver':
    case 'claude:queue':
    case 'claude:title':
    case 'claude:lastPrompt':
    case 'claude:sidechain':
    case 'claude:other':
      return [];
    default:
      return unhandled(e);
  }
}
