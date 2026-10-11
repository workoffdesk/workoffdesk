import type { ScreenRead } from '../agents/claude/screen/screen.js';
import type { Ask } from '../agents/types.js';
import type { ClaudeStatus } from '../agents/types.js';
import type { ChatItem } from '../agents/claude/transcript/chat.js';
import { JournalDb, type MessageRow, type MessageState, type Row } from './db.js';
import { liveShown } from './derive.js';
import { ingest, landFound, onTheirWay, type Titles } from './ingest.js';

export type { MessageRow, MessageState, Row } from './db.js';
export type JournalLog = (msg: string, o: object) => void;

const NOT_LANDED: ReadonlySet<MessageState> = new Set(['delivering', 'delivered', 'enqueued', 'unconfirmed']);

export type Sync ={ epoch: string; v: number; rows: Row[]; more: boolean; reset?: true; older?: number | null };

// As many rows as one answer carries; a copy further behind asks again.
const PAGE_ROWS = 500;
// The items a copy starting over is given, and a page of older ones.
const PAGE_ITEMS = 100;

// What the Machine and the routes write to and read from the journal (db.ts), and who is told of new rows.
export class Journal {
  readonly epoch: string;
  private readonly db: JournalDb;
  private readonly root: string | undefined;
  private readonly log: JournalLog;
  private readonly listeners = new Map<string, Set<(from: number, to: number, rows: Row[]) => void>>();
  // Per session listened to, the version its listeners were last told up to.
  private readonly told = new Map<string, number>();
  private readonly headListeners = new Set<() => void>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly queued = new Map<string, { conv: string | null; p: Promise<void> }>();
  // The reply being written as the screen last read it, and the last one it showed, kept until the
  // transcript grows: the screen stops showing it (a tool runs, the turn ends) before the transcript has it.
  private readonly screenLive = new Map<string, string | null>();
  private readonly heldLive = new Map<string, string>();
  private readonly titled?: (id: string, found: Titles, fresh: boolean) => void;

  constructor(o: { file: string; root?: string; log: JournalLog; titled?: (id: string, found: Titles, fresh: boolean) => void }) {
    this.db = new JournalDb(o.file, o.log);
    this.epoch = this.db.epoch;
    this.root = o.root;
    this.log = o.log;
    this.titled = o.titled;
    // A paste the server stopped in the middle of may have gone in: it is not pasted again.
    for (const { session, m } of this.db.messagesIn('delivering')) this.db.putMessage(session, { ...m, state: 'delivered' });
    const notLanded = [...this.db.messagesIn('delivered'), ...this.db.messagesIn('enqueued'), ...this.db.messagesIn('unconfirmed')];
    for (const session of new Set(notLanded.map((r) => r.session))) landFound(this.db, session, this.log);
    // An ask lives in the server that holds it (PermissionAsks, Codex's agent) and goes with it: none is open
    // when a server starts, whatever the last one wrote.
    for (const session of this.db.sessionsWith('asks')) this.db.putState(session, 'asks', []);
  }

  // The messages sent to a session through WorkOffDesk (the outbox's storage), oldest change first.
  messages(id: string): MessageRow[] {
    return this.db.messages(id);
  }

  putMessage(id: string, m: MessageRow): void {
    this.db.putMessage(id, m);
    this.tell(id);
  }

  // A message as a row, to answer what was done to it with.
  message(id: string, qid: string): Row | null {
    return this.db.message(id, qid);
  }

  // workingSince: when Claude set out on what it is doing, by this Mac's clock.
  status(id: string, status: ClaudeStatus | null): void {
    const wrote = this.db.tx(() => {
      const changed = this.db.putState(id, 'status', status);
      const since = status === 'working' ? changed && this.db.putState(id, 'workingSince', Date.now()) : this.db.putState(id, 'workingSince', null);
      return changed || since;
    });
    if (wrote) this.tell(id);
    if (status === 'idle' || status === 'ended') this.notFoundAfterIngest(id);
  }

  screen(id: string, s: ScreenRead): void {
    const { live, ...screen } = s;
    this.screenLive.set(id, live);
    if (live) this.heldLive.set(id, live);
    const shown = live ?? this.heldLive.get(id) ?? null;
    const conv = this.db.session(id)?.conv;
    const wrote = this.db.tx(() => {
      const a = this.db.putState(id, 'screen', screen);
      const b = this.db.putState(id, 'live', { text: shown && liveShown(shown, conv ? this.db.turnTexts(id, conv) : []) });
      return a || b;
    });
    if (wrote) this.tell(id);
  }

  // What the screen shows, for an agent that says itself what it is writing (Codex).
  screenAsIs(id: string, screen: Omit<ScreenRead, 'live'>): void {
    if (this.db.putState(id, 'screen', screen)) this.tell(id);
  }

  asks(id: string, asks: Ask[]): void {
    if (this.db.putState(id, 'asks', asks)) this.tell(id);
  }

  // How many terminals on the Mac have the session's conversation open in a Claude of their own, each one
  // writing it beside the session's.
  onMac(id: string, terminals: number): void {
    if (this.db.putState(id, 'onMac', terminals)) this.tell(id);
  }

  // Items an agent hands over itself (Codex), in order; one already in is left as it is. A user message that
  // carries the id a message was sent under is that message: it landed.
  putAgentItems(id: string, conv: string, entries: { id: string; item: ChatItem; clientId?: string }[]): void {
    let wrote = false;
    this.db.tx(() => {
      if (this.db.session(id)?.conv !== conv) {
        this.db.setConv(id, conv, 0);
        this.db.putState(id, 'conv', { conv });
        wrote = true;
      }
      let pos = this.db.lastPos(id, conv);
      for (const e of entries) {
        if (!this.db.putItem(id, conv, e.id, pos + 1, e.item)) continue;
        pos++;
        wrote = true;
        const m = e.clientId && this.db.messages(id).find((r) => r.id === e.clientId);
        if (m && NOT_LANDED.has(m.state)) this.db.putMessage(id, { ...m, state: 'landed', item: e.id });
      }
    });
    if (wrote) this.tell(id);
  }

  // The reply an agent is writing, as it says it; null once it is written.
  live(id: string, text: string | null): void {
    if (this.db.putState(id, 'live', { text })) this.tell(id);
  }

  // Takes in what the conversation has added. One run per session at a time; asked meanwhile, one more after.
  ingest(id: string, conv: string | null): Promise<void> {
    const waiting = this.queued.get(id);
    if (waiting) {
      waiting.conv = conv;
      return waiting.p;
    }
    const before = this.running.get(id);
    if (!before) return this.run(id, conv);
    const next: { conv: string | null; p: Promise<void> } = { conv, p: Promise.resolve() };
    next.p = before.then(() => {
      this.queued.delete(id);
      return this.run(id, next.conv);
    });
    this.queued.set(id, next);
    return next.p;
  }

  sync(id: string, epoch: string | undefined, v: number): Sync {
    const now = this.db.session(id)?.v ?? 0;
    if (epoch !== this.epoch || v === 0 || v > now) {
      const first = this.db.firstRows(id, PAGE_ITEMS);
      return { epoch: this.epoch, v: now, rows: first.rows, more: false, reset: true, older: first.older };
    }
    const { rows, more } = this.db.rowsAfter(id, v, PAGE_ROWS);
    return { epoch: this.epoch, v: more ? rows[rows.length - 1].v : now, rows, more };
  }

  older(id: string, conv: string, before: number): { rows: Row[]; older: number | null } {
    return this.db.itemsBefore(id, conv, before, PAGE_ITEMS);
  }

  // Calls cb with each change's rows: from is the version the last call ended at, to the one this ends at.
  onRows(id: string, cb: (from: number, to: number, rows: Row[]) => void): () => void {
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
      this.told.set(id, this.db.session(id)?.v ?? 0);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size || this.listeners.get(id) !== set) return;
      this.listeners.delete(id);
      this.told.delete(id);
    };
  }

  // Each session's version, for a device to tell whether the copy it kept is behind before asking.
  heads(): Record<string, number> {
    return this.db.heads();
  }

  // Calls cb after anything is written to any session.
  onHead(cb: () => void): () => void {
    this.headListeners.add(cb);
    return () => this.headListeners.delete(cb);
  }

  // How many items of what was said the session has.
  itemCount(id: string): number {
    return this.db.itemCount(id);
  }

  drop(id: string): void {
    this.db.drop(id);
    this.screenLive.delete(id);
    this.heldLive.delete(id);
    for (const l of this.headListeners) l();
  }

  close(): void {
    this.db.close();
  }

  private run(id: string, conv: string | null): Promise<void> {
    const p = this.ingestNow(id, conv)
      .catch((e: unknown) => this.log('journal ingest failed', { session: id, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => this.running.get(id) === p && this.running.delete(id));
    this.running.set(id, p);
    return p;
  }

  private async ingestNow(id: string, conv: string | null): Promise<void> {
    if (!this.root) return;
    const wrote = await ingest(this.db, id, conv, {
      root: this.root,
      live: (grew) => {
        const live = this.screenLive.get(id) ?? null;
        if (grew && !live) this.heldLive.delete(id);
        return live ?? this.heldLive.get(id) ?? null;
      },
      log: this.log,
      titled: (found, fresh) => this.titled?.(id, found, fresh),
    });
    if (wrote) this.tell(id);
  }

  // A message delivered before the turn was over that what Claude took in does not have is unconfirmed:
  // shown where it was sent, and said, so a change in how Claude Code records a prompt is seen rather
  // than guessed at. Only those on their way when the turn ended: one delivered after is the next turn's.
  private notFoundAfterIngest(id: string): void {
    const waiting = onTheirWay(this.db, id).map((m) => m.id);
    if (!waiting.length) return;
    void this.ingest(id, this.db.session(id)?.conv ?? null).then(() => {
      let wrote = false;
      for (const m of this.db.messages(id)) {
        if ((m.state !== 'delivered' && m.state !== 'enqueued') || !waiting.includes(m.id)) continue;
        this.db.putMessage(id, { ...m, state: 'unconfirmed' });
        this.log('message not found in the transcript', { session: id, qid: m.id, chars: m.text.length });
        wrote = true;
      }
      if (wrote) this.tell(id);
    });
  }

  private tell(id: string): void {
    for (const l of this.headListeners) l();
    const set = this.listeners.get(id);
    if (!set?.size) return;
    let from = this.told.get(id) ?? 0;
    for (;;) {
      const { rows, more } = this.db.rowsAfter(id, from, PAGE_ROWS);
      if (!rows.length) return;
      const to = more ? rows[rows.length - 1].v : (this.db.session(id)?.v ?? from);
      this.told.set(id, to);
      for (const cb of set) cb(from, to, rows);
      from = to;
      if (!more) return;
    }
  }
}
