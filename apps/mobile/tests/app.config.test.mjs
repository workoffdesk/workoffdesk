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

  test('takes the bundle id from the environment', () => {
    assert.equal(config({ WORKOFFDESK_IOS_BUNDLE_ID: 'dev.someone.app' }).ios.bundleIdentifier, 'dev.someone.app');
  });
});
