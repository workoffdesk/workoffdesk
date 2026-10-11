import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, renameSync } from 'node:fs';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { ChatItem } from '../agents/claude/transcript/chat.js';

// Per session, everything its page shows as rows that each carry the version they were last written at;
// the session's counter only goes up, so a copy catches up by asking for the rows above its own.
// docs/design/2026-10-06-session-journal-design.md

export type RowKind = 'item' | 'message' | 'state';
export type Row = { t: RowKind; key: string; v: number; body: unknown };
export type MessageState = 'queued' | 'delivering' | 'delivered' | 'enqueued' | 'landed' | 'taken' | 'unconfirmed';
export type MessageRow = { id: string; text: string; sentAt: number; state: MessageState; ord: number | null; item: string | null };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS journal (epoch TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, v INTEGER NOT NULL, conv TEXT, conv_read INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS item (
  session TEXT NOT NULL, id TEXT NOT NULL, conv TEXT NOT NULL, pos INTEGER NOT NULL, v INTEGER NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY (session, id)
);
CREATE INDEX IF NOT EXISTS item_by_pos ON item (session, conv, pos);
CREATE INDEX IF NOT EXISTS item_by_v ON item (session, v);
CREATE TABLE IF NOT EXISTS message (
  session TEXT NOT NULL, id TEXT NOT NULL, v INTEGER NOT NULL, text TEXT NOT NULL, sent_at INTEGER NOT NULL,
  state TEXT NOT NULL, ord REAL, item TEXT,
  PRIMARY KEY (session, id)
);
CREATE INDEX IF NOT EXISTS message_by_v ON message (session, v);
CREATE TABLE IF NOT EXISTS state (session TEXT NOT NULL, name TEXT NOT NULL, v INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (session, name));
CREATE INDEX IF NOT EXISTS state_by_v ON state (session, v);
`;

// SQLITE_CORRUPT and SQLITE_NOTADB: a file that cannot be read as a database at all.
const UNREADABLE = new Set([11, 26]);

type ItemDbRow = { id: string; conv: string; pos: number; v: number; body: string };
type MessageDbRow = { id: string; v: number; text: string; sent_at: number; state: MessageState; ord: number | null; item: string | null };
type StateDbRow = { name: string; v: number; body: string };

// The item's id is the row's key: tool, result, task and bg items have an id of their own.
const itemRow = (r: ItemDbRow): Row => ({ t: 'item', key: r.id, v: r.v, body: { ...JSON.parse(r.body), pos: r.pos, conv: r.conv } });
const toMessage = (r: MessageDbRow): MessageRow => ({ id: r.id, text: r.text, sentAt: r.sent_at, state: r.state, ord: r.ord, item: r.item });
const messageRow = (r: MessageDbRow): Row => ({ t: 'message', key: r.id, v: r.v, body: toMessage(r) });
const stateRow = (r: StateDbRow): Row => ({ t: 'state', key: r.name, v: r.v, body: JSON.parse(r.body) });

export class JournalDb {
  readonly epoch: string;
  private readonly db: DatabaseSync;
  private readonly q: Record<string, StatementSync>;
  private depth = 0;

  constructor(file: string, log: (msg: string, o: object) => void = () => {}) {
    let opened: { db: DatabaseSync; epoch: string };
    try {
      opened = open(file);
    } catch (e) {
      if (!UNREADABLE.has((e as { errcode?: number }).errcode ?? -1)) throw e;
      const aside = `${file}.broken-${Date.now()}`;
      renameSync(file, aside);
      for (const side of ['-wal', '-shm']) if (existsSync(file + side)) renameSync(file + side, aside + side);
      log('journal unreadable, set aside and started over', { aside, error: (e as Error).message });
      opened = open(file);
    }
    this.db = opened.db;
    this.epoch = opened.epoch;
    const p = (sql: string) => this.db.prepare(sql);
    this.q = {
      session: p('SELECT v, conv, conv_read AS convRead FROM session WHERE id = ?'),
      heads: p('SELECT id, v FROM session'),
      setConv: p('INSERT INTO session (id, v, conv, conv_read) VALUES (?, 0, ?, ?) ON CONFLICT (id) DO UPDATE SET conv = excluded.conv, conv_read = excluded.conv_read'),
      bump: p('INSERT INTO session (id, v) VALUES (?, 1) ON CONFLICT (id) DO UPDATE SET v = v + 1 RETURNING v'),
      hasItem: p('SELECT 1 FROM item WHERE session = ? AND id = ?'),
      putItem: p('INSERT INTO item (session, id, conv, pos, v, body) VALUES (?, ?, ?, ?, ?, ?)'),
      lastPos: p('SELECT MAX(pos) AS pos FROM item WHERE session = ? AND conv = ?'),
      itemsSince: p('SELECT id, body FROM item WHERE session = ? AND conv = ? AND pos > ? ORDER BY pos'),
      putMessage: p(
        `INSERT INTO message (session, id, v, text, sent_at, state, ord, item) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session, id) DO UPDATE SET v = excluded.v, text = excluded.text, sent_at = excluded.sent_at,
           state = excluded.state, ord = excluded.ord, item = excluded.item`,
      ),
      messages: p('SELECT id, v, text, sent_at, state, ord, item FROM message WHERE session = ? ORDER BY v'),
      message: p('SELECT id, v, text, sent_at, state, ord, item FROM message WHERE session = ? AND id = ?'),
      inState: p('SELECT session, id, v, text, sent_at, state, ord, item FROM message WHERE state = ?'),
      stateBody: p('SELECT body FROM state WHERE session = ? AND name = ?'),
      withState: p('SELECT session FROM state WHERE name = ?'),
      putState: p('INSERT INTO state (session, name, v, body) VALUES (?, ?, ?, ?) ON CONFLICT (session, name) DO UPDATE SET v = excluded.v, body = excluded.body'),
      itemsAfter: p('SELECT id, conv, pos, v, body FROM item WHERE session = ? AND v > ? ORDER BY v LIMIT ?'),
      messagesAfter: p('SELECT id, v, text, sent_at, state, ord, item FROM message WHERE session = ? AND v > ? ORDER BY v LIMIT ?'),
      statesAfter: p('SELECT name, v, body FROM state WHERE session = ? AND v > ? ORDER BY v LIMIT ?'),
      allMessages: p('SELECT id, v, text, sent_at, state, ord, item FROM message WHERE session = ? ORDER BY v'),
      allStates: p('SELECT name, v, body FROM state WHERE session = ? ORDER BY v'),
      itemsBefore: p('SELECT id, conv, pos, v, body FROM item WHERE session = ? AND conv = ? AND pos < ? ORDER BY pos DESC LIMIT ?'),
      newestFirst: p('SELECT body FROM item WHERE session = ? AND conv = ? ORDER BY pos DESC'),
      itemCount: p('SELECT COUNT(*) AS n FROM item WHERE session = ?'),
      dropItems: p('DELETE FROM item WHERE session = ?'),
      dropMessages: p('DELETE FROM message WHERE session = ?'),
      dropStates: p('DELETE FROM state WHERE session = ?'),
      dropSession: p('DELETE FROM session WHERE id = ?'),
    };
  }

  // One transaction, which a call made inside another joins. f must not wait on anything.
  tx<T>(f: () => T): T {
    if (this.depth) {
      this.depth++;
      try {
        return f();
      } finally {
        this.depth--;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try {
      const out = f();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      this.depth = 0;
    }
  }

  session(id: string): { v: number; conv: string | null; convRead: number } | null {
    const r = this.q.session.get(id) as { v: number; conv: string | null; convRead: number } | undefined;
    return r ? { v: r.v, conv: r.conv, convRead: r.convRead } : null;
  }

  setConv(id: string, conv: string | null, convRead: number): void {
    this.q.setConv.run(id, conv, convRead);
  }

  bump(id: string): number {
    return (this.q.bump.get(id) as { v: number }).v;
  }

  // False when the item is there already: an item never changes once written.
  putItem(id: string, conv: string, itemId: string, pos: number, body: unknown): boolean {
    return this.tx(() => {
      if (this.q.hasItem.get(id, itemId)) return false;
      this.q.putItem.run(id, itemId, conv, pos, this.bump(id), JSON.stringify(body));
      return true;
    });
  }

  lastPos(id: string, conv: string): number {
    return (this.q.lastPos.get(id, conv) as { pos: number | null }).pos ?? -1;
  }

  itemsSince(id: string, conv: string, pos: number): { id: string; body: unknown }[] {
    return (this.q.itemsSince.all(id, conv, pos) as { id: string; body: string }[]).map((r) => ({ id: r.id, body: JSON.parse(r.body) }));
  }

  // Claude's words since the last message to it.
  turnTexts(id: string, conv: string): ChatItem[] {
    const texts: ChatItem[] = [];
    for (const r of this.q.newestFirst.iterate(id, conv) as Iterable<{ body: string }>) {
      const item = JSON.parse(r.body) as ChatItem;
      if (item.k === 'user') break;
      if (item.k === 'text') texts.unshift(item);
    }
    return texts;
  }

  putMessage(id: string, m: MessageRow): void {
    this.tx(() => this.q.putMessage.run(id, m.id, this.bump(id), m.text, m.sentAt, m.state, m.ord, m.item));
  }

  // Oldest change first.
  messages(id: string): MessageRow[] {
    return (this.q.messages.all(id) as MessageDbRow[]).map(toMessage);
  }

  message(id: string, qid: string): Row | null {
    const r = this.q.message.get(id, qid) as MessageDbRow | undefined;
    return r ? messageRow(r) : null;
  }

  // Every session's messages in this state.
  messagesIn(state: MessageState): { session: string; m: MessageRow }[] {
    return (this.q.inState.all(state) as (MessageDbRow & { session: string })[]).map((r) => ({ session: r.session, m: toMessage(r) }));
  }

  // False when the body is what is there already: the screen is read four times a second, and a read that
  // finds it the same is no change.
  putState(id: string, name: string, body: unknown): boolean {
    const json = JSON.stringify(body);
    return this.tx(() => {
      const now = this.q.stateBody.get(id, name) as { body: string } | undefined;
      if (now?.body === json) return false;
      this.q.putState.run(id, name, this.bump(id), json);
      return true;
    });
  }

  // Every session that has this state.
  sessionsWith(name: string): string[] {
    return (this.q.withState.all(name) as { session: string }[]).map((r) => r.session);
  }

  state(id: string, name: string): unknown {
    const r = this.q.stateBody.get(id, name) as { body: string } | undefined;
    return r ? JSON.parse(r.body) : undefined;
  }

  // The rows written after version v, oldest first, at most limit of them.
  rowsAfter(id: string, v: number, limit: number): { rows: Row[]; more: boolean } {
    const rows = [
      ...(this.q.itemsAfter.all(id, v, limit + 1) as ItemDbRow[]).map(itemRow),
      ...(this.q.messagesAfter.all(id, v, limit + 1) as MessageDbRow[]).map(messageRow),
      ...(this.q.statesAfter.all(id, v, limit + 1) as StateDbRow[]).map(stateRow),
    ].sort((a, b) => a.v - b.v);
    return { rows: rows.slice(0, limit), more: rows.length > limit };
  }

  // What a copy starting over needs: every message and state, and the newest items of the conversation
  // shown now. older: the pos before which there are more items, null when there are none.
  firstRows(id: string, items: number): { rows: Row[]; older: number | null } {
    const conv = this.session(id)?.conv ?? null;
    const newest = conv ? (this.q.itemsBefore.all(id, conv, Number.MAX_SAFE_INTEGER, items + 1) as ItemDbRow[]) : [];
    const kept = newest.slice(0, items).reverse();
    const rows = [...kept.map(itemRow), ...(this.q.allMessages.all(id) as MessageDbRow[]).map(messageRow), ...(this.q.allStates.all(id) as StateDbRow[]).map(stateRow)];
    return { rows, older: newest.length > items ? kept[0].pos : null };
  }

  // The items of conv before pos, oldest first, at most limit of them; older: the pos before which there
  // are more, null when there are none.
  itemsBefore(id: string, conv: string, pos: number, limit: number): { rows: Row[]; older: number | null } {
    const got = this.q.itemsBefore.all(id, conv, pos, limit + 1) as ItemDbRow[];
    const kept = got.slice(0, limit).reverse();
    return { rows: kept.map(itemRow), older: got.length > limit ? kept[0].pos : null };
  }

  // Each session's version.
  heads(): Record<string, number> {
    return Object.fromEntries((this.q.heads.all() as { id: string; v: number }[]).map((r) => [r.id, r.v]));
  }

  itemCount(id: string): number {
    return (this.q.itemCount.get(id) as { n: number }).n;
  }

  drop(id: string): void {
    this.tx(() => {
      for (const q of [this.q.dropItems, this.q.dropMessages, this.q.dropStates, this.q.dropSession]) q.run(id);
    });
  }

  close(): void {
    this.db.close();
  }
}

// Node has SQLite built in from 22.13 (and 22.5 behind a flag); without it there is no journal.
export const sqliteAvailable = () => !!process.getBuiltinModule('node:sqlite');

function open(file: string): { db: DatabaseSync; epoch: string } {
  const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
  const db = new sqlite.DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 2000;');
    db.exec(SCHEMA);
    // What was said in each session: its owner's only, as everything else in the home is.
    for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);
    const row = db.prepare('SELECT epoch FROM journal LIMIT 1').get() as { epoch: string } | undefined;
    if (row) return { db, epoch: row.epoch };
    const epoch = randomUUID();
    db.prepare('INSERT INTO journal (epoch) VALUES (?)').run(epoch);
    return { db, epoch };
  } catch (e) {
    db.close();
    throw e;
  }
}
