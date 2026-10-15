import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { updateUrlOf } from '../src/updateSource.ts';

const at = (server) => ({ server, token: 't', user: 'u' });

describe('updateUrlOf', () => {
  test('a build of its own updates from the https server it is signed in to, or this phone itself', () => {
    assert.equal(updateUrlOf(at('https://mac.example/')), 'https://mac.example/api/app-update/manifest');
    assert.equal(updateUrlOf(at('http://localhost:7681')), 'http://localhost:7681/api/app-update/manifest');
    assert.equal(updateUrlOf(at('http://mac.example')), null);
    assert.equal(updateUrlOf(null), null);
  });

  test('a published build updates only from the server it names, whatever it is signed in to', () => {
    const fixed = 'https://updates.example/api/app-update/manifest';
    for (const login of [at('https://mac.example'), at('http://localhost:7681'), null]) assert.equal(updateUrlOf(login, fixed), fixed);
  });
});
