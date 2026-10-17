import { cachedChat, forCache, type ChatState } from '@workoffdesk/client/model/chat';
import type { ChatStore } from '@workoffdesk/client/chat/chatFeed';
import { chatsToDrop, type Shown } from '@workoffdesk/client/chat/kept';
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { CHATS_FILE } from './keptFiles';

// A copy of each Mac conversation shown on the phone, so opening one shows it before the Mac answers, and one
// that has ended since still shows what was said. It is only ever a head start: when it cannot be read, the
// chat is read from the Mac. Those not shown lately go when the file is opened (kept.ts).

// The file these copies were kept in before each had a time.
const OLD_FILE = 'workoffdesk-chats';
// The newest pages kept, up to this many items.
const KEEP_ITEMS = 1500;
// A copy that takes longer than this to read would only hold up the read from the Mac.
const READ_WAIT_MS = 500;

let opened: Promise<SQLiteDatabase> | null = null;

function db(): Promise<SQLiteDatabase> {
  if (!opened) {
    const d = (async () => {
      await deleteDatabaseAsync(OLD_FILE).catch(() => {});
      const x = await openDatabaseAsync(CHATS_FILE);
      await x.execAsync('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL);');
      for (const id of chatsToDrop(await x.getAllAsync<Shown>('SELECT id, at FROM chats'), Date.now())) await x.runAsync('DELETE FROM chats WHERE id = ?', id);
      return x;
    })();
    // Not opened: the next use tries again.
    d.catch(() => opened === d && (opened = null));
    opened = d;
  }
  return opened;
}

// While one copy of a chat is being written, only the newest of those that come meanwhile is written after it.
const writing = new Set<string>();
const waiting = new Map<string, ChatState>();

async function write(sessionId: string, chat: ChatState): Promise<void> {
  writing.add(sessionId);
  try {
    await (await db()).runAsync('INSERT OR REPLACE INTO chats (id, at, body) VALUES (?, ?, ?)', sessionId, Date.now(), JSON.stringify(forCache(chat, KEEP_ITEMS)));
  } catch {
    // not kept; the next visit reads from the Mac
  } finally {
    writing.delete(sessionId);
  }
  const next = waiting.get(sessionId);
  if (next) {
    waiting.delete(sessionId);
    void write(sessionId, next);
  }
}

export const chatStore: ChatStore = {
  async kept(sessionId) {
    const read = async () => {
      const x = await db();
      const row = await x.getFirstAsync<{ body: string }>('SELECT body FROM chats WHERE id = ?', sessionId);
      if (!row) return null;
      void x.runAsync('UPDATE chats SET at = ? WHERE id = ?', Date.now(), sessionId).catch(() => {});
      return cachedChat(JSON.parse(row.body));
    };
    const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_WAIT_MS));
    try {
      return await Promise.race([read(), late]);
    } catch {
      return null;
    }
  },
  keep(sessionId, chat) {
    if (writing.has(sessionId)) waiting.set(sessionId, chat);
    else void write(sessionId, chat);
  },
};

// What a logged-out phone must not show the next person, and what clearing the phone's copies takes away.
export async function forgetChats(): Promise<void> {
  waiting.clear();
  const was = opened;
  opened = null;
  await was?.then((x) => x.closeAsync()).catch(() => {});
  await deleteDatabaseAsync(CHATS_FILE).catch(() => {});
}
