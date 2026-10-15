import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deviceOf, keyText, readyPath } from '../src/pushRelay.ts';

const words = { waiting: 'W', idle: 'I', hidden: 'H' };

describe('the iPhone app told to a Mac', () => {
  test('a build of its own: the token, the topic and the words, as before', () => {
    assert.deepEqual(deviceOf('ab', 'com.example.app', words), { token: 'ab', topic: 'com.example.app', words });
    assert.equal(readyPath(undefined), '/api/push/apns');
  });

  test('a published build: also its relay and the key the Mac seals with, and asks whether it can be reached through it', () => {
    const relay = { url: 'https://relay.example', key: 'k' };
    assert.deepEqual(deviceOf('ab', 'com.example.app', words, relay), { token: 'ab', topic: 'com.example.app', words, relay });
    assert.equal(readyPath('https://relay.example'), '/api/push/apns?relay=1');
  });

  test('the key goes as the base64 the Mac reads', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 3);
    assert.equal(keyText(bytes), Buffer.from(bytes).toString('base64'));
    assert.match(keyText(bytes), /^[A-Za-z0-9+/]{43}=$/);
  });
});
