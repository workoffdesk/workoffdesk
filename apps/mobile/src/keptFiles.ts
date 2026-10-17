// The files the phone keeps its copies of chats in: one of the journals for each Mac signed in to
// (journalStore.ts), and one of the Mac conversations shown (chatStore.ts).
export const CHATS_FILE = 'chats.db';
export const journalFile = (mac: string) => `journal-${mac}.db`;

// One of those files, or what SQLite writes beside one.
export const isKeptFile = (name: string) => /^(journal-[0-9a-f]+\.db|chats\.db)(-wal|-shm)?$/.test(name);
