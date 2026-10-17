// The file the phone keeps its copy of the journals in (journalStore.ts).
export const JOURNAL_SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS cursor (session TEXT PRIMARY KEY, epoch TEXT, v INTEGER NOT NULL, older INTEGER, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS held (
  session TEXT NOT NULL, t TEXT NOT NULL, key TEXT NOT NULL, v INTEGER NOT NULL,
  conv TEXT, pos INTEGER, body TEXT NOT NULL,
  PRIMARY KEY (session, t, key)
);
CREATE INDEX IF NOT EXISTS held_item ON held (session, conv, pos) WHERE t = 'item';
`;

// What the phone's copy of the journals (journalStore.ts) drops when its file is opened, as statements and their
// parameters: sessions idle for keepMs, items of a conversation other than the one a session shows, and of that
// one, all but the newest `items`.
export function journalBounds(now: number, keepMs: number, items: number): [string, ...(string | number)[]][] {
  return [
    ['DELETE FROM held WHERE session IN (SELECT session FROM cursor WHERE at < ?)', now - keepMs],
    ['DELETE FROM cursor WHERE at < ?', now - keepMs],
    [
      `DELETE FROM held WHERE t = 'item' AND conv IS NOT (
         SELECT json_extract(c.body, '$.conv') FROM held c WHERE c.session = held.session AND c.t = 'state' AND c.key = 'conv')`,
    ],
    [
      `DELETE FROM held WHERE rowid IN (
         SELECT rowid FROM (SELECT rowid, row_number() OVER (PARTITION BY session ORDER BY pos DESC) AS n FROM held WHERE t = 'item')
         WHERE n > ?)`,
      items,
    ],
  ];
}
