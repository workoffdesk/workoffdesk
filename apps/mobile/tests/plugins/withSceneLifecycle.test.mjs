import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const { appDelegateForScenes, sceneManifest, SCENE_DELEGATE } = require('../../plugins/withSceneLifecycle.js');

// The AppDelegate.swift `expo prebuild` writes for SDK 57, which starts React Native in a window of its own.
const sdk57 = readFileSync(new URL('../fixtures/AppDelegate.sdk57.swift', import.meta.url), 'utf8');

// An app built with the iOS 27 SDK stops at launch unless a scene delegate makes its window.
describe('the scene-based life cycle', () => {
  test('the app delegate leaves the window and React Native to the scene delegate', () => {
    assert.match(sdk57, /startReactNative/, 'precondition: the fixture starts React Native itself');
    const out = appDelegateForScenes(sdk57);
    assert.doesNotMatch(out, /startReactNative/);
    assert.doesNotMatch(out, /UIWindow\(/);
    assert.match(out, /class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider \{/);
    assert.match(out, /reactNativeFactory = factory/);
  });

  test('links still reach the app through its delegate', () => {
    const out = appDelegateForScenes(sdk57);
    assert.match(out, /RCTLinkingManager\.application\(app, open: url/);
    assert.match(out, /RCTLinkingManager\.application\(application, continue: userActivity/);
  });

  test('changes an app delegate already set up for scenes no further', () => {
    const once = appDelegateForScenes(sdk57);
    assert.equal(appDelegateForScenes(once), once);
  });

  for (const [name, src] of [
    ['one that names no ExpoAppDelegate', sdk57.replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: UIResponder {')],
    ['one that starts React Native some other way', sdk57.replace(/#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow/, '    window = UIWindow')],
  ]) {
    test(`refuses an app delegate it does not know, ${name}, rather than build an app that stops at launch`, () => {
      assert.notEqual(src, sdk57, 'precondition: the fixture was changed');
      assert.throws(() => appDelegateForScenes(src));
    });
  }

  test('Info.plist names the scene delegate for the one window the app has', () => {
    const scene = sceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication;
    assert.equal(sceneManifest.UIApplicationSupportsMultipleScenes, false);
    assert.equal(scene.length, 1);
    assert.equal(scene[0].UISceneDelegateClassName, `$(PRODUCT_MODULE_NAME).${SCENE_DELEGATE}`);
  });

  test('every build carries the plugin', () => {
    const config = require('node:child_process').execFileSync('npx', ['--no-install', 'expo', 'config', '--json', '--type', 'public'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, WORKOFFDESK_IOS_PUSH_RELAY: '' },
    });
    assert.ok(JSON.parse(config).plugins.some((p) => JSON.stringify(p).includes('withSceneLifecycle')));
  });
});
