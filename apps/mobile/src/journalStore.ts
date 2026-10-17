import type { JournalRow, JournalStore } from '@workoffdesk/client/journal/journalRows';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { JOURNAL_SCHEMA, journalBounds } from './journalFile';
import { journalFile } from './keptFiles';

// The phone's copy of each session's journal (journal.ts), in a file of its own for each Mac it is signed in
// to: session ids and versions are each Mac's own. It is a head start, never the only way: what cannot be
// read or written here is read from the Mac.

// The newest items of a conversation read back on opening it; earlier ones come from the Mac when scrolled to.
const LOAD_ITEMS = 1500;
// A copy that takes longer than this to read would only hold up the read from the Mac.
const READ_WAIT_MS = 500;
// A session not written to for this long (one that ended long ago) is dropped when the file is opened.
const KEEP_MS = 30 * 24 * 3600_000;

// A row replaces the one held under its key only when it is newer; items never change once written.
const PUT = `INSERT INTO held (session, t, key, v, conv, pos, body) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (session, t, key) DO UPDATE SET v = excluded.v, body = excluded.body WHERE excluded.v > held.v`;

type HeldRow = { t: JournalRow['t']; key: string; v: number; body: string };

const fileFor = async (server: string) => journalFile((await digestStringAsync(CryptoDigestAlgorithm.SHA256, server)).slice(0, 16));

// Opened, the file drops what would never be read back: of the items, it keeps those read back and one to say
// there are more.
async function open(file: string): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(file);
  await db.execAsync(JOURNAL_SCHEMA);
  for (const [sql, ...params] of journalBounds(Date.now(), KEEP_MS, LOAD_ITEMS + 1)) await db.runAsync(sql, ...params);
  return db;
}

// server: the Mac the app is signed in to now, none while signed out.
export function createJournalStore(server: () => string | undefined): JournalStore {
  let opened: { server: string; file: Promise<string>; db: Promise<SQLiteDatabase> } | null = null;
  const db = (): Promise<SQLiteDatabase> | null => {
    const at = server();
    if (!at) return null;
    if (opened?.server !== at) {
      const file = fileFor(at);
      const d = file.then(open);
      // Not opened: the next use tries again.
      d.catch(() => opened?.db === d && (opened = null));
      opened = { server: at, file, db: d };
    }
    return opened.db;
  };
  // Writes go one after another, each in a transaction of its own.
  let writes: Promise<unknown> = Promise.resolve();
  const write = (task: (d: SQLiteDatabase) => Promise<void>) => {
    const d = db();
    if (!d) return;
    writes = writes.then(() => d.then((x) => x.withTransactionAsync(() => task(x)))).catch(() => {});
  };

  const load = async (sessionId: string) => {
    const d = db();
    if (!d) return null;
    const x = await d;
    const cursor = await x.getFirstAsync<{ epoch: string | null; v: number; older: number | null }>('SELECT epoch, v, older FROM cursor WHERE session = ?', sessionId);
    if (!cursor) return null;
    const rest = await x.getAllAsync<HeldRow>("SELECT t, key, v, body FROM held WHERE session = ? AND t != 'item'", sessionId);
    const convRow = rest.find((r) => r.t === 'state' && r.key === 'conv');
    const conv = convRow ? (JSON.parse(convRow.body) as { conv: string | null }).conv : null;
    const items = conv
      ? await x.getAllAsync<HeldRow & { pos: number }>(
          "SELECT t, key, v, body, pos FROM held WHERE session = ? AND t = 'item' AND conv = ? ORDER BY pos DESC LIMIT ?",
          sessionId,
          conv,
          LOAD_ITEMS + 1,
        )
      : [];
    // More held than read back: the earliest read is where the Mac is asked for earlier ones.
    const cut = items.length > LOAD_ITEMS;
    if (cut) items.pop();
    const rows = [...rest, ...items].map((r): JournalRow => ({ t: r.t, key: r.key, v: r.v, body: JSON.parse(r.body) }));
    return { epoch: cursor.epoch, v: cursor.v, older: cut ? items[items.length - 1].pos : cursor.older, rows };
  };

  return {
    load: (sessionId) =>
      Promise.race([load(sessionId), new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_WAIT_MS))]).catch(() => null),

    write(sessionId, at, rows, reset) {
      write(async (x) => {
        if (reset) await x.runAsync("DELETE FROM held WHERE session = ? AND NOT (t = 'message' AND v = 0)", sessionId);
        const put = await x.prepareAsync(PUT);
        try {
          for (const r of rows) {
            const item = r.t === 'item' ? (r.body as { conv?: string; pos?: number }) : null;
            await put.executeAsync([sessionId, r.t, r.key, r.v, item?.conv ?? null, item?.pos ?? null, JSON.stringify(r.body)]);
          }
        } finally {
          await put.finalizeAsync();
        }
        await x.runAsync(
          `INSERT INTO cursor (session, epoch, v, older, at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (session) DO UPDATE SET epoch = excluded.epoch, v = excluded.v, older = excluded.older, at = excluded.at`,
          sessionId,
          at.epoch,
          at.v,
          at.older,
          Date.now(),
        );
      });
    },

    remove(sessionId, key) {
      write(async (x) => {
        await x.runAsync("DELETE FROM held WHERE session = ? AND t = 'message' AND key = ? AND v = 0", sessionId, key);
      });
    },

    // The file of the Mac signed in to now goes, with whatever was written to it.
    async forget() {
      const was = opened;
      opened = null;
      const at = server();
      const file = was?.file ?? (at ? fileFor(at) : null);
      if (!file) return;
      await writes;
      await was?.db.then((x) => x.closeAsync()).catch(() => {});
      await deleteDatabaseAsync(await file).catch(() => {});
    },
  };
}
