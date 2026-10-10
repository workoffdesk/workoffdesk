import { cachedChat, forCache, type ChatState } from '@workoffdesk/client/model/chat';

// A copy of each chat kept on the phone, so opening one shows it before the Mac answers. It is only ever
// a head start: storage may be blocked, cleared, full or slow, and then the chat is read from the Mac.
const DB = 'workoffdesk';
const STORE = 'chats';
// The newest pages kept, up to this many items.
const KEEP_ITEMS = 1500;
// A copy that takes longer than this to read would only hold up the read from the Mac.
const READ_WAIT_MS = 500;

let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  }).catch((e) => {
    opening = null;
    throw e;
  });
  return opening;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function keptChat(sessionId: string): Promise<ChatState | null> {
  const read = async () => cachedChat(await done((await db()).transaction(STORE).objectStore(STORE).get(sessionId)));
  const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_WAIT_MS));
  try {
    return await Promise.race([read(), late]);
  } catch {
    return null;
  }
}

export async function keepChat(sessionId: string, chat: ChatState): Promise<void> {
  try {
    (await db()).transaction(STORE, 'readwrite').objectStore(STORE).put(forCache(chat, KEEP_ITEMS), sessionId);
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
