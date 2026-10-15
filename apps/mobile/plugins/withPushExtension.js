const { copyFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

// A published build's Notification Service Extension (push-extension/NotificationService.swift), which opens
// the notifications its relay passes on. Added only to a build with a relay (app.config.ts).

const NAME = 'NotificationService';
const SWIFT = 'NotificationService.swift';

const plist = (entries) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries}
</dict>
</plist>
`;

const infoPlist = (config, keychainGroup) =>
  plist(`	<key>CFBundleDevelopmentRegion</key>
	<string>$(DEVELOPMENT_LANGUAGE)</string>
	<key>CFBundleDisplayName</key>
	<string>${NAME}</string>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$(PRODUCT_NAME)</string>
	<key>CFBundlePackageType</key>
	<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
	<key>CFBundleShortVersionString</key>
	<string>${config.version}</string>
	<key>CFBundleVersion</key>
	<string>${config.ios.buildNumber}</string>
	<key>WorkOffDeskKeychainGroup</key>
	<string>${keychainGroup}</string>
	<key>NSExtension</key>
	<dict>
		<key>NSExtensionPointIdentifier</key>
		<string>com.apple.usernotifications.service</string>
		<key>NSExtensionPrincipalClass</key>
		<string>$(PRODUCT_MODULE_NAME).NotificationService</string>
	</dict>`);

const entitlements = (keychainGroup) =>
  plist(`	<key>keychain-access-groups</key>
	<array>
		<string>${keychainGroup}</string>
	</array>`);

const withFiles = (config, { keychainGroup }) =>
  withDangerousMod(config, [
    'ios',
    (c) => {
      const dir = join(c.modRequest.platformProjectRoot, NAME);
      mkdirSync(dir, { recursive: true });
      copyFileSync(join(__dirname, 'push-extension', SWIFT), join(dir, SWIFT));
      writeFileSync(join(dir, `${NAME}-Info.plist`), infoPlist(c, keychainGroup));
      writeFileSync(join(dir, `${NAME}.entitlements`), entitlements(keychainGroup));
      return c;
    },
  ]);

const withTarget = (config) =>
  withXcodeProject(config, (c) => {
    const project = c.modResults;
    if (project.pbxTargetByName(NAME)) return c;
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency ??= {};
    objects.PBXContainerItemProxy ??= {};

    const bundleId = `${c.ios.bundleIdentifier}.${NAME}`;
    // Also embeds the extension in the app, and makes the app depend on it.
    const target = project.addTarget(NAME, 'app_extension', NAME, bundleId);
    const group = project.addPbxGroup([SWIFT, `${NAME}-Info.plist`, `${NAME}.entitlements`], NAME, NAME);
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
    project.addBuildPhase([SWIFT], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

    const appSettings = Object.values(project.pbxXCBuildConfigurationSection()).find(
      (b) => b.buildSettings?.PRODUCT_NAME && b.buildSettings?.IPHONEOS_DEPLOYMENT_TARGET && b.name === 'Release' && !String(b.buildSettings.PRODUCT_BUNDLE_IDENTIFIER ?? '').endsWith(NAME),
    )?.buildSettings;
    const configurations = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList].buildConfigurations;
    for (const { value } of configurations) {
      const s = project.pbxXCBuildConfigurationSection()[value].buildSettings;
      Object.assign(s, {
        CODE_SIGN_ENTITLEMENTS: `${NAME}/${NAME}.entitlements`,
        CODE_SIGN_STYLE: 'Automatic',
        INFOPLIST_FILE: `${NAME}/${NAME}-Info.plist`,
        IPHONEOS_DEPLOYMENT_TARGET: appSettings?.IPHONEOS_DEPLOYMENT_TARGET ?? '16.4',
        PRODUCT_BUNDLE_IDENTIFIER: `"${bundleId}"`,
        PRODUCT_NAME: '"$(TARGET_NAME)"',
        SKIP_INSTALL: 'YES',
        SWIFT_VERSION: '5.0',
        TARGETED_DEVICE_FAMILY: '"1,2"',
        ...(appSettings?.DEVELOPMENT_TEAM ? { DEVELOPMENT_TEAM: appSettings.DEVELOPMENT_TEAM } : {}),
      });
    }
    return c;
  });

module.exports = (config, options) => withTarget(withFiles(config, options));
