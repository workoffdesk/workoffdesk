import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { JOURNAL_SCHEMA, journalBounds } from '../src/journalFile.ts';

const NOW = Date.parse('2026-10-17T12:00:00.000Z');
const DAY = 24 * 3600_000;

// A file as journalStore.ts writes it: a cursor per session, and its rows, an item under its conversation and place.
const file = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(JOURNAL_SCHEMA);
  const session = (id, { at = NOW, conv = 'A', items = {} } = {}) => {
    db.prepare('INSERT INTO cursor (session, epoch, v, older, at) VALUES (?, ?, ?, ?, ?)').run(id, 'e', 9, null, at);
    db.prepare("INSERT INTO held (session, t, key, v, conv, pos, body) VALUES (?, 'state', 'conv', 1, NULL, NULL, ?)").run(id, JSON.stringify({ conv }));
    db.prepare("INSERT INTO held (session, t, key, v, conv, pos, body) VALUES (?, 'message', 'q1', 2, NULL, NULL, '{}')").run(id);
    for (const [c, count] of Object.entries(items))
      for (let pos = 0; pos < count; pos++) db.prepare("INSERT INTO held (session, t, key, v, conv, pos, body) VALUES (?, 'item', ?, 0, ?, ?, '{}')").run(id, `${c}:${pos}`, c, pos);
  };
  const bound = (items) => {
    for (const [sql, ...params] of journalBounds(NOW, 30 * DAY, items)) db.prepare(sql).run(...params);
  };
  const held = (id) => db.prepare('SELECT t, key FROM held WHERE session = ? ORDER BY t, conv, pos').all(id).map((r) => `${r.t}:${r.key}`);
  const cursors = () => db.prepare('SELECT session FROM cursor ORDER BY session').all().map((r) => r.session);
  return { session, bound, held, cursors };
};

describe("the bounds on the phone's copy of the journals", () => {
  test('drops a session not written to for longer than it keeps one, and keeps one written to since', () => {
    const f = file();
    f.session('old', { at: NOW - 31 * DAY, items: { A: 2 } });
    f.session('new', { at: NOW - 29 * DAY, items: { A: 2 } });
    f.bound(10);
    assert.deepEqual(f.cursors(), ['new']);
    assert.deepEqual(f.held('old'), []);
    assert.deepEqual(f.held('new'), ['item:A:0', 'item:A:1', 'message:q1', 'state:conv']);
  });

  test("keeps of a session's items only the newest of the conversation it shows, its messages and states whole", () => {
    const f = file();
    f.session('s', { conv: 'B', items: { A: 3, B: 5 } });
    f.session('t', { conv: 'A', items: { A: 2 } });
    f.bound(3);
    assert.deepEqual(f.held('s'), ['item:B:2', 'item:B:3', 'item:B:4', 'message:q1', 'state:conv']);
    assert.deepEqual(f.held('t'), ['item:A:0', 'item:A:1', 'message:q1', 'state:conv']);
  });
});
