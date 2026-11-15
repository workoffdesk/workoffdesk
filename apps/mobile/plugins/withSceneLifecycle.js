const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { IOSConfig, withAppDelegate, withDangerousMod, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

// An app built with the iOS 27 SDK stops at launch unless it adopts the scene-based life cycle. Expo's
// ExpoAppSceneDelegate makes the window and starts React Native in it; SDK 58's template wires it in the
// way this plugin does for SDK 57's.

const SCENE_DELEGATE = 'SceneDelegate';
const FILE = `${SCENE_DELEGATE}.swift`;

const sceneDelegateSwift = `internal import Expo

@objc(${SCENE_DELEGATE})
class ${SCENE_DELEGATE}: ExpoAppSceneDelegate {
}
`;

const sceneManifest = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: `$(PRODUCT_MODULE_NAME).${SCENE_DELEGATE}` },
    ],
  },
};

const CLASS = 'class AppDelegate: ExpoAppDelegate {';
const FOR_SCENES = 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {';
const OWN_WINDOW = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([^)]*\)\n#endif\n/;

// The AppDelegate.swift of SDK 57's template, made to hand its window to the scene delegate. Throws on any
// other shape: an app delegate that still starts React Native itself would build, and then stop at launch.
function appDelegateForScenes(src) {
  if (src.includes(FOR_SCENES) && !src.includes('startReactNative')) return src;
  if (!src.includes(CLASS) || !OWN_WINDOW.test(src)) {
    throw new Error("withSceneLifecycle: AppDelegate.swift is not SDK 57's; set it up for scenes by hand (see Expo SDK 58's template)");
  }
  return src.replace(CLASS, FOR_SCENES).replace(OWN_WINDOW, '');
}

const withSceneDelegateFile = (config) =>
  withDangerousMod(config, [
    'ios',
    (c) => {
      writeFileSync(join(c.modRequest.platformProjectRoot, c.modRequest.projectName, FILE), sceneDelegateSwift);
      return c;
    },
  ]);

const withSceneDelegateSource = (config) =>
  withXcodeProject(config, (c) => {
    const project = c.modResults;
    const name = c.modRequest.projectName;
    if (!project.hasFile(`${name}/${FILE}`)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: `${name}/${FILE}`, groupName: name, project });
    }
    return c;
  });

const withScenes = (config) => {
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = sceneManifest;
    return c;
  });
  config = withAppDelegate(config, (c) => {
    if (c.modResults.language !== 'swift') throw new Error('withSceneLifecycle: expects a Swift AppDelegate');
    c.modResults.contents = appDelegateForScenes(c.modResults.contents);
    return c;
  });
  return withSceneDelegateSource(withSceneDelegateFile(config));
};

module.exports = withScenes;
module.exports.appDelegateForScenes = appDelegateForScenes;
module.exports.sceneManifest = sceneManifest;
module.exports.SCENE_DELEGATE = SCENE_DELEGATE;
