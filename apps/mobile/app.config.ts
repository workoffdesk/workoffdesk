import type { ConfigContext, ExpoConfig } from 'expo/config';

// Each person signs the app with their own Apple team, so the bundle id is theirs to give.
const bundleIdentifier = process.env.WORKOFFDESK_IOS_BUNDLE_ID || 'com.example.workoffdesk';

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
    url: 'https://workoffdesk.invalid/api/app-update/manifest',
    checkAutomatically: 'ON_ERROR_RECOVERY',
    fallbackToCacheTimeout: 0,
    disableAntiBrickingMeasures: true,
    enableBsdiffPatchSupport: false,
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier,
    buildNumber: '20',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
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
  ],
  scheme: 'workoffdesk',
  experiments: {
    typedRoutes: true,
  },
  locales: {
    'zh-Hans': './locales/zh-Hans.json',
  },
});
