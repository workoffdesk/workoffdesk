import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, test } from 'node:test';

const config = (env) =>
  JSON.parse(
    execFileSync('npx', ['--no-install', 'expo', 'config', '--json', '--type', 'public'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, ...env },
      encoding: 'utf8',
    }),
  );

describe('app.config', () => {
  test("gives a build with no bundle id of its own a placeholder, not anyone's real one", () => {
    const c = config({ WORKOFFDESK_IOS_BUNDLE_ID: '' });
    assert.equal(c.ios.bundleIdentifier, 'com.example.workoffdesk');
    assert.equal(c.name, 'WorkOffDesk');
    assert.equal(c.scheme, 'workoffdesk');
  });

  test('a build of its own fetches JS from the server it is signed in to and has no relay, as before', () => {
    const c = config({ WORKOFFDESK_IOS_UPDATE_URL: '', WORKOFFDESK_IOS_PUSH_RELAY: '' });
    assert.equal(c.updates.url, 'https://workoffdesk.invalid/api/app-update/manifest');
    assert.equal(c.extra?.updateUrl, undefined);
    assert.equal(c.extra?.pushRelay, undefined);
    assert.equal(c.ios.entitlements?.['keychain-access-groups'], undefined);
    assert.ok(!JSON.stringify(c.plugins).includes('withPushExtension'));
  });

  test('a published build fetches JS only from the update server it names', () => {
    const url = 'https://updates.example/api/app-update/manifest';
    const c = config({ WORKOFFDESK_IOS_UPDATE_URL: url });
    assert.equal(c.updates.url, url);
    assert.equal(c.extra.updateUrl, url);
  });

  test('a published build with a relay shares a keychain group with its notification extension', () => {
    const c = config({ WORKOFFDESK_IOS_BUNDLE_ID: 'dev.someone.app', WORKOFFDESK_TEAM_ID: 'TEAM123456', WORKOFFDESK_IOS_PUSH_RELAY: 'https://relay.example' });
    assert.equal(c.extra.pushRelay, 'https://relay.example');
    assert.deepEqual(c.ios.entitlements['keychain-access-groups'], ['TEAM123456.dev.someone.app.push']);
    assert.equal(c.extra.keychainGroup, 'TEAM123456.dev.someone.app.push');
    assert.ok(JSON.stringify(c.plugins).includes('withPushExtension'));
  });

  test('refuses to build with a relay but no team to name the keychain group by', () => {
    assert.throws(() => config({ WORKOFFDESK_TEAM_ID: '', WORKOFFDESK_IOS_PUSH_RELAY: 'https://relay.example' }));
  });

  for (const [name, env] of [
    ['an update server that is not https', { WORKOFFDESK_IOS_UPDATE_URL: 'http://updates.example/api/app-update/manifest' }],
    ['a relay that is not an https origin', { WORKOFFDESK_IOS_PUSH_RELAY: 'https://relay.example/path' }],
  ]) {
    test(`refuses to build with ${name}`, () => {
      assert.throws(() => config(env));
    });
  }

  test('takes the bundle id from the environment', () => {
    assert.equal(config({ WORKOFFDESK_IOS_BUNDLE_ID: 'dev.someone.app' }).ios.bundleIdentifier, 'dev.someone.app');
  });
});
