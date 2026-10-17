import { chatsToDrop, type Shown } from '@workoffdesk/client/chat/kept';
import { cachedChat, forCache, type ChatState } from '@workoffdesk/client/model/chat';

// A copy of each chat kept on the phone, so opening one shows it before the Mac answers. It is only ever
// a head start: storage may be blocked, cleared, full or slow, and then the chat is read from the Mac. Those
// not shown lately go when the browser opens it (kept.ts).
const DB = 'workoffdesk';
const STORE = 'chats';
// When each was last shown.
const SHOWN = 'shown';
// The newest pages kept, up to this many items.
const KEEP_ITEMS = 1500;
// A copy that takes longer than this to read would only hold up the read from the Mac.
const READ_WAIT_MS = 500;

let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const names = req.result.objectStoreNames;
      if (!names.contains(STORE)) req.result.createObjectStore(STORE);
      if (!names.contains(SHOWN)) req.result.createObjectStore(SHOWN, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(bounded(req.result));
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  }).catch((e) => {
    opening = null;
    throw e;
  });
  return opening;
}

// Drops the copies not shown lately, one kept before they had a time among them; the database either way.
async function bounded(d: IDBDatabase): Promise<IDBDatabase> {
  try {
    const tx = d.transaction([STORE, SHOWN], 'readwrite');
    const [ids, shown] = await Promise.all([done(tx.objectStore(STORE).getAllKeys()), done(tx.objectStore(SHOWN).getAll() as IDBRequest<Shown[]>)]);
    const timed = new Set(shown.map((c) => c.id));
    for (const id of [...ids.filter((id) => !timed.has(String(id))).map(String), ...chatsToDrop(shown, Date.now())]) {
      tx.objectStore(STORE).delete(id);
      tx.objectStore(SHOWN).delete(id);
    }
  } catch {
    // dropped the next time
  }
  return d;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function keptChat(sessionId: string): Promise<ChatState | null> {
  const read = async () => {
    const tx = (await db()).transaction([STORE, SHOWN], 'readwrite');
    const chat = cachedChat(await done(tx.objectStore(STORE).get(sessionId)));
    if (chat) tx.objectStore(SHOWN).put({ id: sessionId, at: Date.now() });
    return chat;
  };
  const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_WAIT_MS));
  try {
    return await Promise.race([read(), late]);
  } catch {
    return null;
  }
}

export async function keepChat(sessionId: string, chat: ChatState): Promise<void> {
  try {
    const tx = (await db()).transaction([STORE, SHOWN], 'readwrite');
    tx.objectStore(STORE).put(forCache(chat, KEEP_ITEMS), sessionId);
    tx.objectStore(SHOWN).put({ id: sessionId, at: Date.now() });
  } catch {
    // not kept; the next visit reads from the Mac
  }
}

// What a logged-out browser must not show the next person.
export async function forgetChats(): Promise<void> {
  try {
    const open = opening;
    opening = null;
    (await open?.catch(() => null))?.close();
    indexedDB.deleteDatabase(DB);
  } catch {
    // nothing was kept
  }
}
