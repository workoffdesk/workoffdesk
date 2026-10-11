import { sentWords, type ChatItem } from '../agents/claude/transcript/chat.js';
import { eventOf } from '../agents/claude/transcript/events.js';
import { findTranscript, idItems, linesFrom } from '../agents/claude/transcript/transcriptFile.js';
import { queueInTranscript } from '../agents/claude/transcript/turn.js';
import type { JournalDb, MessageRow } from './db.js';
import { backgroundRunning, liveShown, taskList } from './derive.js';

// The names a run found the conversation given, the latest of each: custom by /rename, ai by Claude itself.
// fresh: read from its start, a conversation new to the session.
export type Titles = { custom?: string; ai?: string };

export type IngestOptions = {
  root: string;
  titled?: (found: Titles, fresh: boolean) => void;
  // The reply being written as the screen last showed it; wrote: the transcript has just grown.
  live: (wrote: boolean) => string | null;
  log: (msg: string, o: object) => void;
};

// The transcript records a prompt when Claude Code takes it, after it was pasted.
const LANDS_AFTER_MS = -2000;
const DERIVED: ReadonlySet<ChatItem['k']> = new Set(['task', 'todos', 'bg']);
// What a paste keeps of a message (Machine.paste): no control characters but line breaks and tabs.
const pasted = (text: string) => text.replace(/(?![\n\t])\p{Cc}/gu, '').trim();

const ON_THEIR_WAY: ReadonlySet<MessageRow['state']> = new Set(['delivering', 'delivered', 'enqueued']);

// The messages that went to Claude and are not known to have been taken in, oldest first.
export const onTheirWay = (db: JournalDb, id: string) =>
  db
    .messages(id)
    .filter((m) => ON_THEIR_WAY.has(m.state))
    .sort((a, b) => a.sentAt - b.sentAt);

// The messages a prompt in the transcript may be, oldest first: those on their way, and those not found when
// a turn ended, which Claude may take in after it (once a slow line brings it).
const notLanded = (db: JournalDb, id: string) =>
  db
    .messages(id)
    .filter((m) => ON_THEIR_WAY.has(m.state) || m.state === 'unconfirmed')
    .sort((a, b) => a.sentAt - b.sentAt);

// Takes the session's conversation into the journal from where it stopped, in transactions of whole lines,
// with what is worked out from it. True when anything was written.
export async function ingest(db: JournalDb, id: string, conv: string | null, o: IngestOptions): Promise<boolean> {
  if (!conv) return false;
  const path = await findTranscript(o.root, conv);
  if (!path) return false;
  let wrote = false;
  let changedConv = db.session(id)?.conv !== conv;
  const fresh = changedConv;
  const found: Titles = {};
  if (changedConv) {
    db.tx(() => {
      db.setConv(id, conv, 0);
      db.putState(id, 'conv', { conv });
    });
    wrote = true;
  }
  for (;;) {
    const from = db.session(id)?.convRead ?? 0;
    const read = await linesFrom(path, from);
    // The conversation may have changed while the file was read; the next ingest takes the new one.
    if (db.session(id)?.conv !== conv || db.session(id)?.convRead !== from) return wrote;
    const more = read.next < read.size && read.lines.length > 0;
    db.tx(() => {
      let pos = db.lastPos(id, conv);
      let derived = changedConv;
      let items = false;
      let queueMoved = false;
      const waiting = notLanded(db, id);
      for (const { at, line } of read.lines) {
        queueMoved ||= line.includes('"queue-operation"');
        titleIn(line, found);
        for (const { id: itemId, item } of idItems(line, at)) {
          if (!db.putItem(id, conv, itemId, ++pos, item)) {
            pos--;
            continue;
          }
          items = true;
          if (DERIVED.has(item.k)) derived = true;
          land(db, id, waiting, item, itemId, o.log);
        }
      }
      if (derived) {
        const all = db.itemsSince(id, conv, -1).map((r) => r.body as ChatItem);
        db.putState(id, 'tasks', taskList(all));
        db.putState(id, 'background', backgroundRunning(all));
      }
      if (items) db.putState(id, 'live', { text: liveShown(o.live(true), db.turnTexts(id, conv)) });
      if (queueMoved) wrote = inClaudesQueue(db, id, queueInTranscript(path), o.log) || wrote;
      db.setConv(id, conv, read.next);
      wrote ||= items;
    });
    changedConv = false;
    if (more) continue;
    if (fresh || found.custom || found.ai) o.titled?.(found, fresh);
    return wrote;
  }
}

// A record of a name the conversation was given, kept in found.
function titleIn(line: string, found: Titles): void {
  if (!line.includes('-title"')) return;
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return;
  }
  const e = eventOf(v);
  if (e.k !== 'title' || !e.text.trim()) return;
  if (e.by === 'person') found.custom = e.text;
  else found.ai = e.text;
}

// Lands the messages not landed that the conversation already has, each at the first prompt with its words
// that no other message is: the prompt was read before the message was known to be on its way.
export function landFound(db: JournalDb, id: string, log: IngestOptions['log']): void {
  const conv = db.session(id)?.conv;
  const waiting = notLanded(db, id);
  if (!conv || !waiting.length) return;
  const taken = new Set(db.messages(id).map((m) => m.item));
  db.tx(() => {
    for (const { id: itemId, body } of db.itemsSince(id, conv, -1)) {
      if (!taken.has(itemId)) land(db, id, waiting, body as ChatItem, itemId, log);
    }
  });
}

// A message on its way whose words Claude holds in its own queue is enqueued, the oldest first for words held
// twice: one pasted while the status had not caught up with Claude being at work. One stays enqueued until it
// lands, or is not found when the turn is over. One whose words were pulled back into the prompt at the Mac
// after it was sent, and are not held again, is taken back. True when any changed.
function inClaudesQueue(db: JournalDb, id: string, queue: ReturnType<typeof queueInTranscript>, log: IngestOptions['log']): boolean {
  const left = queue.held.map((t) => t.trim());
  const pulled = queue.pulled.map((p) => ({ text: p.text.trim(), at: p.at }));
  let changed = false;
  for (const m of onTheirWay(db, id)) {
    const i = left.indexOf(pasted(m.text));
    if (i < 0) {
      const p = pulled.findIndex((x) => x.text === pasted(m.text) && !(x.at - m.sentAt < LANDS_AFTER_MS));
      if (p < 0) continue;
      pulled.splice(p, 1);
      db.putMessage(id, { ...m, state: 'taken', ord: null });
      log('message pulled back at the Mac', { session: id, qid: m.id });
      changed = true;
      continue;
    }
    left.splice(i, 1);
    if (m.state === 'enqueued') continue;
    db.putMessage(id, { ...m, state: 'enqueued' });
    changed = true;
  }
  return changed;
}

// The oldest message not known to be taken in whose words are the prompt's (or the command's) is it: it landed.
function land(db: JournalDb, id: string, waiting: MessageRow[], item: ChatItem, itemId: string, log: IngestOptions['log']): void {
  const words = sentWords(item);
  if (words === null) return;
  const at = 'at' in item && item.at ? Date.parse(item.at) : NaN;
  const text = words.trim();
  const n = waiting.findIndex((m) => pasted(m.text) === text && !(at - m.sentAt < LANDS_AFTER_MS));
  if (n < 0) return;
  const [m] = waiting.splice(n, 1);
  db.putMessage(id, { ...m, state: 'landed', item: itemId });
  log('message landed', { session: id, qid: m.id, item: itemId, was: m.state, ms: Date.now() - m.sentAt });
}
