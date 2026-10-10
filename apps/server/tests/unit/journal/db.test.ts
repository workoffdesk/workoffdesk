import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { JournalDb } from '../../../src/journal/db.js';

const dir = mkdtempSync(join(tmpdir(), 'ts-journal-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const S = 'session-1';

const closing: (() => void)[] = [];
afterEach(() => {
  for (const c of closing.splice(0)) c();
});

describe('JournalDb', () => {
  describe('tx', () => {
    it('writes a transaction whole or not at all, and one inside another is part of it', () => {
      const db = new JournalDb(join(dir, 'tx.db'));
      closing.push(() => db.close());
      expect(() =>
        db.tx(() => {
          db.putState(S, 'a', 1);
          db.tx(() => db.putState(S, 'b', 2));
          throw new Error('stopped');
        }),
      ).toThrow('stopped');
      expect([db.state(S, 'a'), db.state(S, 'b'), db.session(S)]).toEqual([undefined, undefined, null]);
      db.tx(() => {
        db.putState(S, 'a', 1);
        db.tx(() => db.putState(S, 'b', 2));
      });
      expect([db.state(S, 'a'), db.state(S, 'b'), db.session(S)?.v]).toEqual([1, 2, 2]);
    });
  });
});
