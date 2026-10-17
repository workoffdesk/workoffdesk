import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CHATS_FILE, isKeptFile, journalFile } from '../src/keptFiles.ts';

describe("the files of the phone's copies of chats", () => {
  for (const [name, kept] of [
    [journalFile('0123456789abcdef'), true],
    [`${journalFile('0123456789abcdef')}-wal`, true],
    [`${journalFile('0123456789abcdef')}-shm`, true],
    [CHATS_FILE, true],
    [`${CHATS_FILE}-wal`, true],
    ['ExpoSQLiteStorage', false],
    ['workoffdesk-chats', false],
    ['journal.txt', false],
  ])
    test(`${kept ? 'are' : 'are not'} ${name}`, () => assert.equal(isKeptFile(name), kept));
});
