import type { ConfigContext, ExpoConfig } from 'expo/config';

// Each person signs the app with their own Apple team, so the bundle id is theirs to give.
const bundleIdentifier = process.env.WORKOFFDESK_IOS_BUNDLE_ID || 'com.example.workoffdesk';

// A build published for others (docs/design/2026-10-16-app-store-build.md): the one server its JS updates
// come from, and the relay its notifications come through. Unset, the app updates from the server it is
// signed in to, and that server's own key sends its notifications.
const updateUrl = setting('WORKOFFDESK_IOS_UPDATE_URL', (u) => u.protocol === 'https:');
const pushRelay = setting('WORKOFFDESK_IOS_PUSH_RELAY', (u) => u.protocol === 'https:' && u.href === `${u.origin}/`);
// Where the app keeps the key its relayed notifications are sealed with, for its notification extension to read.
const keychainGroup = pushRelay && `${teamId()}.${bundleIdentifier}.push`;

function teamId(): string {
  const id = process.env.WORKOFFDESK_TEAM_ID;
  if (!id) throw new Error('WORKOFFDESK_IOS_PUSH_RELAY needs WORKOFFDESK_TEAM_ID, the team that signs the app');
  return id;
}

function setting(name: string, ok: (u: URL) => boolean): string | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  let u: URL | null = null;
  try {
    u = new URL(v);
  } catch {
    // said below
  }
  if (!u || !ok(u)) throw new Error(`${name} must be an https ${name.endsWith('RELAY') ? 'origin' : 'URL'}: ${v}`);
  return name.endsWith('RELAY') ? u.origin : v;
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'WorkOffDesk',
  slug: 'workoffdesk',
  platforms: ['ios', 'android'],
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  runtimeVersion: {
    policy: 'fingerprint',
  },
  updates: {
    url: updateUrl ?? 'https://workoffdesk.invalid/api/app-update/manifest',
    checkAutomatically: 'ON_ERROR_RECOVERY',
    fallbackToCacheTimeout: 0,
    disableAntiBrickingMeasures: true,
    enableBsdiffPatchSupport: false,
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier,
    buildNumber: '21',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
    ...(keychainGroup ? { entitlements: { 'keychain-access-groups': [keychainGroup] } } : {}),
  },
  extra: {
    ...config.extra,
    ...(updateUrl ? { updateUrl } : {}),
    ...(pushRelay ? { pushRelay, keychainGroup } : {}),
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#2f81f7',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-updates',
    'expo-notifications',
    'expo-router',
    'expo-status-bar',
    [
      'expo-secure-store',
      {
        faceIDPermission: 'WorkOffDesk keeps your sign-in in the iPhone keychain; it does not use Face ID.',
      },
    ],
    'expo-sqlite',
    [
      'expo-localization',
      {
        supportedLocales: {
          ios: ['en', 'zh-Hans'],
          android: ['en', 'zh-CN'],
        },
      },
    ],
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'WorkOffDesk uses the microphone while you hold to talk, to turn what you say into a message.',
        speechRecognitionPermission: 'WorkOffDesk turns what you say into text for your message while you hold to talk.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'WorkOffDesk opens your photos only when you pick a picture to send to your session.',
        cameraPermission: 'WorkOffDesk uses the camera to take a picture and send it to your session.',
        microphonePermission: 'WorkOffDesk uses the microphone while you hold to talk, to turn what you say into a message.',
      },
    ],
    'expo-video',
    ...(keychainGroup ? [['./plugins/withPushExtension', { keychainGroup }] as [string, unknown]] : []),
  ],
  scheme: 'workoffdesk',
  experiments: {
    typedRoutes: true,
  },
  locales: {
    'zh-Hans': './locales/zh-Hans.json',
  },
});
