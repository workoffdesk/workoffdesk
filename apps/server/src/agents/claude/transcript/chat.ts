import { stripVTControlCharacters } from 'node:util';
import { isOwnHookCommand } from '../hooks/hooks.js';

// A Claude session as a conversation, read from its transcript. The format is Claude Code's own and
// undocumented: every field is optional, and a record not understood is left out, never thrown on.

export type ChatItem =
  | { k: 'user'; text: string; at?: string }
  | { k: 'text'; text: string; at?: string }
  | { k: 'tool'; id: string; name: string; summary: string; at?: string; plan?: string }
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
// What Claude Code records as the answer of a call it was stopped before running.
const STOPPED = /^The user doesn't want to (proceed with this tool use|take this action)/;

// A transcript line once it is known to be an object. Every field may be missing or of any type;
// message is only ever read through optional chaining, which is safe on whatever it turns out to be.
export type TranscriptRecord = { [field: string]: unknown; message?: { content?: unknown } };

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

// As text, without the colours and links a terminal would have drawn from it.
function blocksText(content: unknown): string {
  if (typeof content === 'string') return stripVTControlCharacters(content);
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b?.type === 'text' ? stripVTControlCharacters(str(b.text)) : b?.type === 'image' ? '[image]' : ''))
    .filter(Boolean)
    .join(' ');
}

export function toolSummary(name: string, input: Record<string, unknown>): string {
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
  const s = named?.() ?? Object.values(input).map(str).find(Boolean) ?? '';
  return clip(s.split('\n')[0], SUMMARY_MAX);
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

// A command Claude ran in the background, or one the user sent there while it ran.
function backgroundStarted(v: unknown, tool: string): ChatItem[] {
  const id = v && typeof v === 'object' ? (v as { backgroundTaskId?: unknown }).backgroundTaskId : null;
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

function userItems(r: TranscriptRecord, at: string | undefined): ChatItem[] {
  const content = r.message?.content;
  if (r.isCompactSummary) return [{ k: 'note', event: { e: 'compacted' } }];
  if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) {
    const results = content.filter((b) => b?.type === 'tool_result' && typeof b.tool_use_id === 'string');
    const diff = results.length === 1 && results[0].is_error !== true ? fileChange(r.toolUseResult) : null;
    const made = results.length === 1 && results[0].is_error !== true ? taskMade(r.toolUseResult) : null;
    const shown: ChatItem[] = results.map((b): ChatItem => {
      const text = blocksText(b.content);
      if (STOPPED.test(text)) return { k: 'result', id: b.tool_use_id, text: '', error: false, stopped: true };
      const item: ChatItem = { k: 'result', id: b.tool_use_id, text: clip(text, RESULT_MAX), error: b.is_error === true };
      if (diff) item.diff = diff;
      return Array.isArray(b.content) && b.content.some((c: { type?: unknown } | null) => c?.type === 'image') ? { ...item, image: true } : item;
    });
    const started = results.length === 1 ? backgroundStarted(r.toolUseResult, results[0].tool_use_id) : [];
    return [...shown, ...(made ? [made] : []), ...started];
  }
  const text = blocksText(content).trim();
  if (!text) return [];
  if (text.startsWith('[Request interrupted')) return [{ k: 'note', event: { e: 'interrupted' }, retry: true }];
  const command = /<command-name>([^<]*)<\/command-name>/.exec(text);
  if (command?.[1].trim() === '/compact') return [];
  if (command) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1].trim();
    return [{ k: 'note', text: [command[1].trim(), args].filter(Boolean).join(' '), command: true, at }];
  }
  const stdout = /^<local-command-std(?:out|err)>([\s\S]*)<\/local-command-std(?:out|err)>$/.exec(text);
  if (stdout) {
    const shown = stdout[1].split('\n').filter((l) => !ownHookLine(l)).join('\n').trim();
    return shown ? [{ k: 'note', text: clip(shown, RESULT_MAX) }] : [];
  }
  return [{ k: 'user', text, at }];
}

// The words a message sent to Claude has when the transcript records it as this item: a prompt's, or a
// command's typed at the prompt. Null for anything a message cannot be.
export function sentWords(item: ChatItem): string | null {
  if (item.k === 'user') return item.text;
  return item.k === 'note' && 'command' in item && item.command ? item.text : null;
}

const XML_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const tagText = (text: string, tag: string) =>
  new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1].replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => XML_ENTITIES[e]).trim() ?? '';

function taskNote(text: string): ChatItem[] {
  const summary = tagText(text, 'summary');
  const what = /^Background command "([\s\S]*)" (?:completed|failed|was stopped)/.exec(summary)?.[1] ?? summary;
  const status = tagText(text, 'status');
  const id = tagText(text, 'task-id');
  const note: ChatItem = { k: 'note', event: { e: 'task', status, what }, detail: summary };
  return id && status ? [note, { k: 'bg', id, status }] : [note];
}

// Teammates' messages, which Claude Code records with no sender: it wraps them in this envelope instead.
// A body that is a JSON object is a status update between agents (idle, shutting down), for Claude alone.
const TEAMMATES = 'Another Claude session sent a message:\n<teammate-message ';
function fromTeammates(text: string): ChatItem[] | null {
  if (!text.startsWith(TEAMMATES)) return null;
  return [...text.matchAll(/<teammate-message\s[^>]*?teammate_id="([^"]*)"[^>]*>([\s\S]*?)<\/teammate-message>/g)].flatMap(([, from, body]): ChatItem[] => {
    const detail = body.trim();
    return detail && !/^\{[\s\S]*\}$/.test(detail) ? [{ k: 'note', event: { e: 'peer', from }, detail }] : [];
  });
}

// A prompt that did not come from the user: Claude Code records who sent it. Older versions record
// nobody, and then the prompt is the user's, unless it is a teammate's message in its envelope.
function sentByOther(r: TranscriptRecord): ChatItem[] | null {
  const origin = r.origin && typeof r.origin === 'object' ? (r.origin as Record<string, unknown>) : null;
  if (!origin) return fromTeammates(blocksText(r.message?.content).trim());
  if (origin.kind === 'human') return null;
  if (origin.kind === 'peer') return [{ k: 'note', event: { e: 'peer', from: str(origin.name) }, detail: str(origin.body) }];
  if (r.isMeta) return [];
  const text = blocksText(r.message?.content).trim();
  if (origin.kind === 'task-notification') return taskNote(text);
  return text ? [{ k: 'note', text: clip(text, RESULT_MAX) }] : [];
}

// The plan Claude asks to go ahead with, shown whole rather than as a line: written into Claude Code's
// plans folder in plan mode, or given to ExitPlanMode itself by older versions.
const PLAN_FILE = /\/\.claude\/plans\/[^/]+\.md$/;
function planOf(name: string, input: Record<string, unknown>): string {
  if (name === 'ExitPlanMode') return str(input.plan).trim();
  if (name === 'Write' && PLAN_FILE.test(str(input.file_path))) return str(input.content).trim();
  return '';
}

function assistantItems(r: TranscriptRecord, at: string | undefined): ChatItem[] {
  const content = r.message?.content;
  if (!Array.isArray(content)) return [];
  const out: ChatItem[] = [];
  for (const b of content) {
    if (b?.type === 'text' && str(b.text).trim()) out.push({ k: 'text', text: b.text.trim(), at });
    if (b?.type === 'tool_use' && typeof b.id === 'string') {
      const name = str(b.name) || 'Tool';
      const input = b.input && typeof b.input === 'object' ? b.input : {};
      const plan = planOf(name, input);
      out.push({ k: 'tool', id: b.id, name, summary: toolSummary(name, input), at, ...(plan && { plan }) }, ...taskItems(name, input));
    }
  }
  return out;
}

// A message the user sent while Claude worked, which Claude took in the middle of its turn: the transcript
// has it only as this attachment.
function takenMidTurn(r: TranscriptRecord, at: string | undefined): ChatItem[] {
  const a = r.attachment && typeof r.attachment === 'object' ? (r.attachment as Record<string, unknown>) : null;
  if (a?.type !== 'queued_command' || a.isMeta) return [];
  const origin = a.origin && typeof a.origin === 'object' ? (a.origin as Record<string, unknown>) : null;
  // How a background command ended, taken in mid-turn: only the end is kept, the note comes as its own prompt.
  if (origin?.kind === 'task-notification' || a.commandMode === 'task-notification')
    return taskNote(blocksText(a.prompt)).filter((i) => i.k === 'bg');
  if ((a.commandMode ?? 'prompt') !== 'prompt' || (origin && origin.kind !== 'human')) return [];
  const text = blocksText(a.prompt).trim();
  return text ? [{ k: 'user', text, at }] : [];
}

// What one transcript record shows in the conversation. Subagents' own turns, Claude's thinking and
// text injected for Claude alone are not part of it.
export function chatItems(v: unknown): ChatItem[] {
  if (!v || typeof v !== 'object') return [];
  const r = v as TranscriptRecord;
  if (r.isSidechain) return [];
  const at = typeof r.timestamp === 'string' ? r.timestamp : undefined;
  if (r.type === 'attachment') return takenMidTurn(r, at);
  if (!r.message || typeof r.message !== 'object') return [];
  if (r.type === 'user') return sentByOther(r) ?? (r.isMeta ? [] : userItems(r, at));
  // A reply the API failed to give: what Claude Code wrote in its place says why.
  if (r.type === 'assistant' && r.isApiErrorMessage) {
    const event: NoteEvent = r.error === 'rate_limit' ? { e: 'failed', limit: true } : { e: 'failed' };
    return [{ k: 'note', event, detail: clip(blocksText(r.message.content).replace(/^API Error:\s*/, ''), RESULT_MAX), retry: true }];
  }
  if (r.type === 'assistant') return assistantItems(r, at);
  return [];
}
