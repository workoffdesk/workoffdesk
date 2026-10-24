import type { ClaudeStatus, Queued } from '../base/api';
import type { Ask, ChatItem, OnScreen, Turn } from '../model/chat';
import { behindMac } from './pushes';

// A device's copy of each session's journal on the Mac (docs/design/2026-10-06-session-journal-design.md): rows
// that each carry the version they were last written at, applied only when newer than the one held, so
// whatever order they come in, and however often, the copy ends the same. A session's page draws only
// from its view of the copy.

export type JournalRow = { t: 'item' | 'message' | 'state'; key: string; v: number; body: unknown };
// sending: on its way from this device to the Mac, which has not answered yet; enqueued: in Claude's own queue.
export type MessageState = 'sending' | 'queued' | 'delivering' | 'delivered' | 'enqueued' | 'landed' | 'taken' | 'unconfirmed';
export type Message = { id: string; text: string; sentAt: number; state: MessageState; ord: number | null; item: string | null };
// A turn of the conversation, with its id in the journal, its place, and the conversation it is in.
export type JournalItem = ChatItem & { itemId: string; pos: number; conv: string };
export type Task = { subject: string; status: string };
export type Background = { id: string; label: string };

export type SessionView = {
  // The copy has what the Mac has: it answered since the page opened, or the copy kept from before is at the
  // version the Mac last said. Until then it can be behind.
  synced: boolean;
  // The Mac has not answered for a while.
  failed: boolean;
  // The Mac has no such session.
  gone: boolean;
  // The list's socket says the Mac's journal has moved past the copy: what it says Claude is doing may be old.
  behind: boolean;
  conv: string | null;
  items: JournalItem[];
  older: boolean;
  loadingOlder: boolean;
  messages: Message[];
  status: ClaudeStatus | null;
  // When Claude set out on what it is doing, by the Mac's clock.
  workingSince: number | null;
  // With what Claude Code waits on (asks); nothing while a card pressed waits for the screen to be read again.
  screen: OnScreen;
  // A card was pressed and the screen has not been read since.
  screenStale: boolean;
  live: string | null;
  tasks: Task[];
  background: Background[];
  // How many terminals on the Mac have this conversation open in a Claude of their own, writing it too.
  onMac: number;
};

type Held<T> = { v: number; body: T };
export type Copy = {
  epoch: string | null;
  v: number;
  items: Map<string, JournalItem>;
  messages: Map<string, Held<Message>>;
  states: Map<string, Held<unknown>>;
  older: number | null;
};

// Where a copy is kept beyond the page: the iPhone app's SQLite. Without one it lives as long as the page.
// A reset keeps the messages this device is still sending (v 0); remove drops one the Mac turned down.
export type JournalStore = {
  load(sessionId: string): Promise<{ epoch: string | null; v: number; older: number | null; rows: JournalRow[] } | null>;
  write(sessionId: string, at: { epoch: string | null; v: number; older: number | null }, rows: JournalRow[], reset: boolean): void;
  remove(sessionId: string, key: string): void;
  forget(): Promise<void>;
};

export type JournalSync = { epoch: string; v: number; rows: JournalRow[]; more: boolean; reset?: true; older?: number | null };

const NOTHING_ON_SCREEN: OnScreen = { choices: null, panel: null };
export const emptyCopy = (): Copy => ({ epoch: null, v: 0, items: new Map(), messages: new Map(), states: new Map(), older: null });

export const emptyView: SessionView = {
  synced: false,
  failed: false,
  behind: false,
  gone: false,
  conv: null,
  items: [],
  older: false,
  loadingOlder: false,
  messages: [],
  status: null,
  workingSince: null,
  screen: NOTHING_ON_SCREEN,
  screenStale: false,
  live: null,
  tasks: [],
  background: [],
  onMac: 0,
};

// Applies rows to a copy: each replaces what is held under its key only when it is newer. Items never
// change once written. A reset starts the copy over, keeping only what this device is still sending.
export function applyRows(c: Copy, rows: JournalRow[], reset = false): void {
  if (reset) {
    c.items.clear();
    c.states.clear();
    for (const [id, m] of c.messages) if (m.body.state !== 'sending') c.messages.delete(id);
  }
  for (const r of rows) {
    if (r.t === 'item') {
      if (!c.items.has(r.key)) c.items.set(r.key, { ...(r.body as ChatItem & { pos: number; conv: string }), itemId: r.key });
    } else {
      const held = r.t === 'message' ? c.messages : c.states;
      const was = held.get(r.key);
      if (!was || r.v > was.v) held.set(r.key, { v: r.v, body: r.body as never });
    }
  }
}

// The chat waits on the Mac, shown as a skeleton, until it has what the Mac has, so it shows once, whole,
// rather than changing under the reader as it catches up. A Mac that does not answer leaves what is held.
export const chatPending = (v: SessionView, ended: boolean): boolean => !v.synced && !v.failed && !ended;

export type Flags = { synced: boolean; failed: boolean; gone: boolean; loadingOlder: boolean; screenHidden: boolean };

export function viewOf(id: string, c: Copy, { screenHidden, ...flags }: Flags): SessionView {
  const state = <T>(name: string, none: T): T => (c.states.get(name)?.body as T | undefined) ?? none;
  const conv = state<{ conv: string | null }>('conv', { conv: null }).conv;
  const items = [...c.items.values()].filter((i) => i.conv === conv).sort((a, b) => a.pos - b.pos);
  return {
    ...flags,
    behind: behindMac(id, c),
    conv,
    items,
    older: c.older !== null,
    messages: [...c.messages.values()].map((m) => m.body),
    status: state<ClaudeStatus | null>('status', null),
    workingSince: state<number | null>('workingSince', null),
    screen: screenHidden ? NOTHING_ON_SCREEN : { ...state<OnScreen>('screen', NOTHING_ON_SCREEN), asks: state<Ask[]>('asks', []) },
    screenStale: screenHidden,
    live: state<{ text: string | null }>('live', { text: null }).text,
    tasks: state<Task[]>('tasks', []),
    background: state<Background[]>('background', []),
    onMac: state<number>('onMac', 0),
  };
}

const ON_ITS_WAY: ReadonlySet<MessageState> = new Set(['sending', 'delivering', 'delivered']);
// The statuses the Mac holds a message in rather than typing it in (outbox.ts HOLDS).
const HOLDS: ReadonlySet<ClaudeStatus> = new Set(['starting', 'waiting', 'compacting', 'ended']);

// Whether the Mac holds a message sent now: Claude cannot take it, or others wait before it.
const holds = (view: SessionView) => (view.status !== null && HOLDS.has(view.status)) || view.messages.some((m) => m.state === 'queued');

// Where a message Claude has not read yet waits: held by the Mac, which it can still be changed in; on its way
// to the Mac; or in Claude's own queue, which Claude reads at its next step. Null: not in the queue tray.
export type Waits = 'mac' | 'sending' | 'claude';

function waits(view: SessionView, m: Message, held: boolean): Waits | null {
  if (m.state === 'queued') return 'mac';
  if (m.state === 'enqueued') return 'claude';
  // Sent while Claude works, so going into Claude's queue.
  if (m.state === 'sending') return held || view.status === 'working' ? 'sending' : null;
  return null;
}

// A message as the queue tray shows it; only one the Mac holds can be changed.
export type InQueue = Queued & { waits: Waits };

// The queue, in the order Claude will read it: what is in Claude's own queue, what the Mac holds, in its
// order, then what is on its way, so a message is where it will stay from the moment it is sent. Those
// being taken back (leaving) are left out.
export function queue(view: SessionView, leaving: ReadonlySet<string>): InQueue[] {
  const held = holds(view);
  const rank: Record<Waits, number> = { claude: 0, mac: 1, sending: 2 };
  return view.messages
    .flatMap((m) => {
      const w = waits(view, m, held);
      return w && !leaving.has(m.id) ? [{ m, w }] : [];
    })
    .sort((a, b) => rank[a.w] - rank[b.w] || (a.w === 'mac' ? (a.m.ord ?? 0) - (b.m.ord ?? 0) : a.m.sentAt - b.m.sentAt))
    .map(({ m, w }) => ({ id: m.id, text: m.text, at: m.sentAt, waits: w }));
}

// What the page marks from the messages, given the turns it draws (keyed by pos, chat.ts turns): the
// prompt shown as sent (a landed message's, while nothing follows it), and the bubbles after the
// conversation, oldest first (on their way and not to be held, or not found in the transcript until a later
// prompt is).
export function onShow(view: SessionView, shown: Turn[]): { sent: Set<string>; bubbles: Message[] } {
  const last = shown.at(-1);
  const keyOf = new Map(view.items.map((i) => [i.itemId, String(i.pos)]));
  const sent = new Set<string>();
  if (last?.k === 'user' && view.messages.some((m) => m.state === 'landed' && m.item && keyOf.get(m.item) === last.key)) sent.add(last.key);
  const prompt = shown.findLast((t) => t.k === 'user');
  const promptAt = prompt?.k === 'user' && prompt.at ? Date.parse(prompt.at) : -Infinity;
  const held = holds(view);
  const bubbles = view.messages
    .filter((m) => (ON_ITS_WAY.has(m.state) && !waits(view, m, held)) || (m.state === 'unconfirmed' && !(promptAt > m.sentAt)))
    .sort((a, b) => a.sentAt - b.sentAt);
  return { sent, bubbles };
}
