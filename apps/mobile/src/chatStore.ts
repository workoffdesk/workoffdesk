import { cachedChat, forCache, type ChatState } from '@workoffdesk/client/model/chat';
import type { ChatStore } from '@workoffdesk/client/chat/chatFeed';
import { SQLiteStorage } from 'expo-sqlite/kv-store';

// A copy of each chat kept on the phone, so opening one shows it before the Mac answers, and one that has
// ended since still shows what was said. It is only ever a head start: when it cannot be read, the chat is
// read from the Mac.
const chats = new SQLiteStorage('workoffdesk-chats');
// The newest pages kept, up to this many items.
const KEEP_ITEMS = 1500;
// A copy that takes longer than this to read would only hold up the read from the Mac.
const READ_WAIT_MS = 500;

// While one copy of a chat is being written, only the newest of those that come meanwhile is written after it.
const writing = new Set<string>();
const waiting = new Map<string, ChatState>();

async function write(sessionId: string, chat: ChatState): Promise<void> {
  writing.add(sessionId);
  try {
    await chats.setItemAsync(sessionId, JSON.stringify(forCache(chat, KEEP_ITEMS)));
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
    const read = async () => cachedChat(JSON.parse((await chats.getItemAsync(sessionId)) ?? 'null'));
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

// What a logged-out phone must not show the next person.
export function forgetChats(): void {
  waiting.clear();
  chats.clearAsync().catch(() => {});
}
