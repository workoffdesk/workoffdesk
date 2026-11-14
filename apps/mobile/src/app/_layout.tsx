import { t } from '@workoffdesk/i18n';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, usePathname, useRootNavigationState, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onPage, pageBeforeReopen, useAppUpdates } from '../appUpdate';
import { ErrorScreen, sayUncaughtErrors } from '../errors';
import { useLogin, useSplit } from '../hooks';
import { Sidebar } from '../components/Sidebar';
import { MacTooOld } from '../MacTooOld';
import { VideoPlayer } from '../components/VideoPlayer';
import { useNotifications } from '../notifications';
import { useTheme } from '../theme';

sayUncaughtErrors();
export { ErrorScreen as ErrorBoundary };

// A session opened from a link or a notification has the list under it, for Back to go to.
export const unstable_settings = { initialRouteName: 'index' };

// Signed in, the sessions and what hangs off them; signed out, only the login.
export default function RootLayout() {
  const { c, dark, fs } = useTheme();
  const login = useLogin();
  const signedIn = !!login;
  useAppUpdates();
  const path = usePathname();
  useNotifications(signedIn, path);
  const navReady = !!useRootNavigationState()?.key;
  const split = useSplit();
  const { left, right } = useSafeAreaInsets();
  useEffect(() => onPage(path), [path]);
  useEffect(() => {
    if (!navReady || !signedIn) return;
    const before = pageBeforeReopen();
    if (before && before !== '/') router.push(before as Href);
  }, [navReady, signedIn]);
  // From one account to another, the pages start afresh from the new one's sessions.
  const token = login?.token;
  const shown = useRef(token);
  useEffect(() => {
    const was = shown.current;
    shown.current = token;
    if (was && token && was !== token && router.canDismiss()) router.dismissAll();
  }, [token]);
  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, primary: c.accent, background: c.bg, card: c.surface, text: c.text, border: c.border },
  };
  return (
    <KeyboardProvider>
      <ThemeProvider value={navTheme}>
        <StatusBar style="auto" />
        {/* On a wide screen the session list stays on the left; the stack keeps its place in the tree, so
            opening the screen out or folding it keeps what is open. On its side, the camera and the rounded
            corners take the screen's sides, and every page keeps clear of them here. */}
        <View style={{ flex: 1, flexDirection: 'row', paddingLeft: left, paddingRight: right, backgroundColor: c.bg }}>
          {signedIn && split && <Sidebar width={split.list} />}
          <View style={{ flex: 1 }}>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: c.surface },
                headerTintColor: c.text,
                headerTitleStyle: { color: c.text, fontSize: fs(17) },
                headerBackButtonDisplayMode: 'minimal',
                contentStyle: { backgroundColor: c.bg },
              }}
            >
              <Stack.Protected guard={signedIn}>
                <Stack.Screen name="index" options={{ title: t.sessions }} />
                <Stack.Screen name="session/[id]" options={{ title: t.session, headerShown: false }} />
                <Stack.Screen name="settings" options={{ title: t.settings, headerShown: false }} />
                <Stack.Screen name="mac" options={{ title: t.thisMac, headerShown: false }} />
                <Stack.Screen name="new-session" options={{ title: t.newSession, presentation: 'modal' }} />
                <Stack.Screen name="conversations" options={{ title: t.conversationsOnMac, headerBackTitle: t.back }} />
                <Stack.Screen name="claude/[sid]" options={{ title: t.macSession, headerShown: false }} />
                <Stack.Screen name="codex/[sid]" options={{ title: t.macSession, headerShown: false }} />
                <Stack.Screen name="claude/[sid]/agents/[tool]" options={{ title: t.subagent, headerShown: false }} />
                <Stack.Screen name="add-account" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
              </Stack.Protected>
              <Stack.Protected guard={!signedIn}>
                <Stack.Screen name="login" options={{ headerShown: false }} />
              </Stack.Protected>
            </Stack>
          </View>
        </View>
        {signedIn && <VideoPlayer />}
        {signedIn && <MacTooOld />}
      </ThemeProvider>
    </KeyboardProvider>
  );
}
