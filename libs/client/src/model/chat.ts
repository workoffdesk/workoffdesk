import { shortPath } from './format';
import { t } from '@workoffdesk/i18n';

// What the chat route sends; the shape is server/agents/claude/transcript/chat.ts's ChatItem.
export type ChatItem =
  | { k: 'user'; text: string; at?: string }
  | { k: 'text'; text: string; at?: string }
  | { k: 'tool'; id: string; name: string; summary: string; input?: string; at?: string; plan?: string }
  // stopped: the call never ran; Claude Code was stopped (Esc) before it did.
  | { k: 'result'; id: string; text: string; error: boolean; stopped?: true; image?: true; diff?: Diff }
  | { k: 'note'; text: string; detail?: string; retry?: true; command?: true; at?: string }
  | { k: 'note'; event: NoteEvent; detail?: string; retry?: true }
  | { k: 'task'; id: string; subject?: string; status?: string }
  | { k: 'todos'; items: { subject: string; status: string }[] }
  | { k: 'bg'; id: string; tool?: string; status: string };
export type NoteEvent =
  | { e: 'compacted' }
  | { e: 'interrupted' }
  // limit: the account hit a usage limit, which another account does not share.
  | { e: 'failed'; limit?: true }
  | { e: 'task'; status: string; what: string }
  // pid: the sender's process, to go to it by.
  | { e: 'peer'; from: string; pid?: number };
// What a note says, in the phone's language when the server sent it as an event.
export function noteText(n: { text: string } | { event: NoteEvent }): string {
  if ('text' in n) return n.text;
  const e = n.event;
  if (e.e === 'task') return t.noteTask(e.status, e.what);
  if (e.e === 'peer') return t.notePeer(e.from);
  if (e.e === 'failed') return e.limit ? t.noteLimit : t.noteFailed;
  return e.e === 'compacted' ? t.noteCompacted : t.noteInterrupted;
}
// A note of a reply the account's usage limit stopped.
export const isLimit = (n: { k: string; event?: NoteEvent }) => n.k === 'note' && n.event?.e === 'failed' && !!n.event.limit;
export type Hunk = { oldStart: number; newStart: number; lines: string[] };
export type Diff = { file: string; added: number; removed: number; created?: true; cut?: true; hunks: Hunk[] };

// What the choices route sends; the shape is server/agents/claude/screen/choices.ts's Choices.
export type Choices = {
  context: string;
  options: { label: string; detail: string; typed?: true; ticked?: boolean }[];
  cursor: number;
  submit?: string;
  // The plan Claude asks to go ahead with.
  plan?: string;
  // A picker the person opened (/model, /rewind), not something Claude asks.
  opened?: true;
};
// A dialog open over Claude's prompt; the shape is server/agents/claude/screen/panel.ts's Panel.
export type Panel = {
  title: string;
  body: string;
  hint: string;
  usage?: { session: number | null; week: number | null };
  effort?: { levels: string[]; at: number };
  btw?: { question: string };
};
// How the chat names a panel; one it cannot tell is not given a name that may be wrong.
// Its title as the dialog spaces it out on screen ("Status   Config") reads as words, as a browser shows it.
export const panelName = (p: Panel) => (p.title ? t.panelNamed(t.panelTitles[p.title] ?? p.title.replace(/\s+/g, ' ')) : t.aPanel);
// A level of /effort in the reader's words.
export const effortName = (level: string) => t.effortLevels[level] ?? level;
// The levels /effort takes, from fastest to most thorough.
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// A model /model takes, as Claude Code lists it for the session (server/agents/claude/offers/models.ts). value: what
// /model is given; efforts: the levels /effort takes with it.
export type ModelChoice = { value: string; name: string; about: string; efforts: string[] };
// A line of the model menu: the command it types, and whether it is the model in use.
export type ModelItem = { label: string; sub?: string; current: boolean; command: string };

// The models /model takes by name, each the latest of its kind, for when Claude Code's own list cannot be had.
const MODEL_NAMES: { alias: string; name: string }[] = [
  { alias: 'opus', name: 'Opus' },
  { alias: 'fable', name: 'Fable' },
  { alias: 'sonnet', name: 'Sonnet' },
  { alias: 'haiku', name: 'Haiku' },
];

// The model menu for a session using `model` (its name as the status line shows it): Claude Code's list when
// there is one, else the names above and its own /model dialog for the rest.
export function modelItems(models: ModelChoice[] | null | undefined, model: string | undefined): ModelItem[] {
  if (!models?.length) {
    return [
      ...MODEL_NAMES.map((m) => ({ label: m.name, current: false, command: `/model ${m.alias}` })),
      { label: t.otherModels, current: false, command: '/model' },
    ];
  }
  return models.map((m) => ({ label: m.name, sub: m.about || undefined, current: m.name === model, command: `/model ${m.value}` }));
}

// The levels /effort takes with `model`, as Claude Code lists them; all of them when it is not known.
export const effortsOf = (models: ModelChoice[] | null | undefined, model: string | undefined) => {
  const known = models?.find((m) => m.name === model)?.efforts;
  return known?.length ? known : EFFORTS;
};

// Claude Code's headings for the pickers it opens, as panelTitles names them.
const PICKER_TITLES: Record<string, string> = { 'Select model': 'Model' };
const SETTINGS_TABS = /^Settings\s{2,}Status\s{2,}Config\b/;
const SEARCH_BOX = /^[╭│╰]/;
// A picker's heading and what it says under it, from the lines above its options: the settings dialog's row
// of tabs and its search box are not for reading.
export function pickerHead(context: string): { title: string; about: string } {
  const lines = context
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !SEARCH_BOX.test(l));
  const first = lines[0] ?? '';
  if (SETTINGS_TABS.test(first)) return { title: t.panelTitles.Settings, about: '' };
  const known = PICKER_TITLES[first];
  if (known) return { title: t.panelTitles[known], about: t.dialogAbout[known] ?? lines.slice(1).join(' ') };
  return { title: first, about: lines.slice(1).join(' ') };
}

// What a session waits on the person for, as the agent itself said; the shape is server/agents/types.ts's.
export type Ask = { id: string; kind: 'permission'; tool: string; title: string; detail: string; always: Always | null };
export type Always = { rules: string[]; dirs: string[]; mode: string | null };
export type Answer = { allow: true; always?: true } | { allow: false };

// What a "yes, and from now on" also allows, in the reader's words; the rules themselves are code, shown
// apart (askOptions' `code`).
const alwaysSays = (a: Always) =>
  [
    ...(a.mode ? [t.alwaysMode(a.mode)] : []),
    ...(a.rules.length ? [t.alwaysRules] : []),
    ...(a.dirs.length ? [t.alwaysDirs(a.dirs.map((d) => shortPath(d)).join(t.listSeparator))] : []),
  ].join(t.alwaysJoin);

// The options a permission card offers, each with the answer it sends; code: the rules a "from now on"
// keeps to, one a line.
export const askOptions = (ask: Ask): { label: string; detail?: string; code?: string; answer: Answer }[] => [
  { label: t.allowYes, answer: { allow: true } },
  ...(ask.always
    ? [
        {
          label: t.allowAlways(alwaysSays(ask.always)),
          ...(ask.always.rules.length > 0 && { code: ask.always.rules.join('\n') }),
          answer: { allow: true as const, always: true as const },
        },
      ]
    : []),
  { label: t.allowNo, detail: t.allowNoDetail, answer: { allow: false } },
];

// suggestion: what Claude offers the user to say next; mode: the permission mode, null in the default one.
// live: what Claude is writing that the transcript does not have yet (server/agents/claude/screen/live.ts).
// background: Claude Code offers to send the tool it runs in the foreground to the background.
// asks: what it waits on the person for, from servers that say so. The screen's choices show the same
// prompt again while one is open, so they are not shown beside it.
export type OnScreen = { choices: Choices | null; panel: Panel | null; suggestion?: string | null; mode?: string | null; live?: string | null; background?: boolean; asks?: Ask[] };

// Claude Code's own dialog is up: a panel, or a picker the person opened that has nothing to tick.
export const hasDialog = (on: OnScreen) => !!on.panel || (!!on.choices?.opened && !on.choices.submit);

export type ChatRead = { sid: string | null; items: ChatItem[]; from: number; next: number; skipped: boolean };
// What is shown, read from the transcript in pages: each knows the byte it starts at, so the turns before
// it can be asked for, and a copy can be cut down to its newest pages. `base` numbers the first item, so
// every item keeps its number as pages come in before it.
export type ChatState = { sid: string | null; items: ChatItem[]; next: number; base: number; pages: { start: number; count: number }[] };

export const emptyChat: ChatState = { sid: null, items: [], next: 0, base: 0, pages: [] };

export const hasOlder = (s: ChatState) => (s.pages[0]?.start ?? 0) > 0;

// A read that did not start where the last one stopped (another transcript, a first read, a file that
// started over) replaces what was read before; one that did continues it.
export function applyChat(s: ChatState, r: ChatRead): ChatState {
  if (r.sid !== s.sid || r.from !== s.next || !s.pages.length) {
    return { sid: r.sid, items: r.items, next: r.next, base: 0, pages: [{ start: r.from, count: r.items.length }] };
  }
  const last = s.pages.at(-1)!;
  return { ...s, items: [...s.items, ...r.items], next: r.next, pages: [...s.pages.slice(0, -1), { ...last, count: last.count + r.items.length }] };
}

// A page of earlier turns goes before what is shown, if it ends where that starts.
export function applyOlder(s: ChatState, r: ChatRead): ChatState | null {
  if (r.sid !== s.sid || !s.pages.length || r.next !== s.pages[0].start) return null;
  return { ...s, items: [...r.items, ...s.items], base: s.base - r.items.length, pages: [{ start: r.from, count: r.items.length }, ...s.pages] };
}

// The copy kept on the phone: the newest pages up to `max` items, the newest one whole.
export function forCache(s: ChatState, max: number): ChatState {
  let drop = 0;
  let dropped = 0;
  while (drop < s.pages.length - 1 && s.items.length - dropped > max) dropped += s.pages[drop++].count;
  return { ...s, items: s.items.slice(dropped), base: s.base + dropped, pages: s.pages.slice(drop) };
}

const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;

// A kept copy as it was kept, or nothing: it may be from an older version of this page, or damaged.
export function cachedChat(v: unknown): ChatState | null {
  const c = v as ChatState;
  if (!c || typeof c !== 'object' || !(c.sid === null || typeof c.sid === 'string')) return null;
  if (!Array.isArray(c.items) || !count(c.next) || !Number.isSafeInteger(c.base) || !Array.isArray(c.pages)) return null;
  if (!c.pages.every((p) => p && count(p.start) && count(p.count))) return null;
  if (c.pages.reduce((n, p) => n + p.count, 0) !== c.items.length) return null;
  return c;
}

type ToolResult = Omit<Extract<ChatItem, { k: 'result' }>, 'k' | 'id'>;
// The call Claude has made and has no answer to yet, the last one: what it is doing now.
export function callGoing(items: ChatItem[]): Extract<ChatItem, { k: 'tool' }> | null {
  const answered = new Set<string>();
  for (let n = items.length - 1; n >= 0; n--) {
    const i = items[n];
    if (i.k === 'result') answered.add(i.id);
    else if (i.k === 'tool' && !answered.has(i.id)) return i;
  }
  return null;
}

export type ToolTurn = Extract<ChatItem, { k: 'tool' }> & { result?: ToolResult };
// A file a reply changed, with every change to it counted, and the last call that changed it.
export type Changed = { file: string; added: number; removed: number; created?: true; tool: string };
type Changes = { k: 'changes'; files: Changed[] };
export type Turn = (Exclude<ChatItem, { k: 'tool' } | { k: 'result' } | { k: 'task' } | { k: 'todos' } | { k: 'bg' }> | ToolTurn | Changes) & { key: string };

// Calls that only keep Claude's task list: the task bar shows the list instead.
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite']);

// Items in the order they happened. A message sent while Claude worked is written to the transcript only
// once Claude takes it, after what it did meanwhile, though dated when it was sent: it goes back to then.
function inTimeOrder(items: ChatItem[]): { i: ChatItem; n: number }[] {
  const out = items.map((i, n) => ({ i, n }));
  const when = (i: ChatItem) => ('at' in i && i.at ? Date.parse(i.at) : NaN);
  for (let pos = 0; pos < out.length; pos++) {
    const sent = when(out[pos].i);
    if (out[pos].i.k !== 'user' || Number.isNaN(sent)) continue;
    let to = pos;
    for (let k = pos - 1; k >= 0 && out[k].i.k !== 'user'; k--) {
      const at = when(out[k].i);
      if (Number.isNaN(at)) continue;
      if (at <= sent) break;
      to = k;
    }
    if (to < pos) out.splice(to, 0, ...out.splice(pos, 1));
  }
  return out;
}

// What is shown: each tool call carries what it printed, which the transcript records later, apart. A reply
// that changed files lists them under its last words; one still going on, or ending otherwise, does not.
export function turns(items: ChatItem[], base: number): Turn[] {
  const results = new Map<string, ToolResult>();
  for (const i of items) if (i.k === 'result') results.set(i.id, { text: i.text, error: i.error, stopped: i.stopped, image: i.image, diff: i.diff });
  const out: Turn[] = [];
  let changed = new Map<string, Changed>();
  const close = () => {
    const last = out.at(-1);
    if (changed.size && last?.k === 'text') out.push({ k: 'changes', files: [...changed.values()], key: `changes-${last.key}` });
    changed = new Map();
  };
  for (const { i, n } of inTimeOrder(items)) {
    if (i.k === 'result' || i.k === 'task' || i.k === 'todos' || i.k === 'bg') continue;
    if (i.k === 'user') close();
    if (i.k !== 'tool') {
      out.push({ ...i, key: String(base + n) });
      continue;
    }
    if (TASK_TOOLS.has(i.name)) continue;
    const result = results.get(i.id);
    out.push({ ...i, result, key: i.id });
    const d = result?.diff;
    if (!d) continue;
    const was = changed.get(d.file);
    changed.set(d.file, {
      file: d.file,
      added: (was?.added ?? 0) + d.added,
      removed: (was?.removed ?? 0) + d.removed,
      ...(was?.created || d.created ? { created: true as const } : {}),
      tool: i.id,
    });
  }
  close();
  return out;
}

// What the chat draws in a row: a turn, or calls made one after another, drawn as one row that opens to
// them. A plan and a picture are kept out, as they are what is read. going: the calls are where Claude is
// at, so they go on even between one call's answer and the next call.
export type Row = { k: 'one'; t: Turn } | { k: 'tools'; key: string; tools: (ToolTurn & { key: string })[]; going: boolean };

const foldable = (t: Turn): t is ToolTurn & { key: string } => t.k === 'tool' && !t.plan && !(t.name === 'Read' && t.result?.image);

// working: Claude is working on a turn.
export function rows(shown: Turn[], working = false): Row[] {
  const out: Row[] = [];
  let run: (ToolTurn & { key: string })[] = [];
  const close = (last = false) => {
    // Under its first call's key, so the row a call is drawn in stays the same row as calls join it.
    if (run.length > 1) out.push({ k: 'tools', key: run[0].key, tools: run, going: working && last });
    else if (run.length) out.push({ k: 'one', t: run[0] });
    run = [];
  };
  for (const t of shown) {
    if (foldable(t)) run.push(t);
    else {
      close();
      out.push({ k: 'one', t });
    }
  }
  close(true);
  return out;
}

// A file tool's absolute path, name first: on a phone the end of a path is the part that gets cut off.
export function filePath(p: string): { name: string; dir: string } | null {
  const cut = p.lastIndexOf('/');
  if (!p.startsWith('/') || cut === p.length - 1) return null;
  return { name: p.slice(cut + 1), dir: shortPath(p.slice(0, cut)) || '/' };
}

