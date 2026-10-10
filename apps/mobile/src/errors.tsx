import { t } from '@workoffdesk/i18n';
import * as Clipboard from 'expo-clipboard';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useAppUpdates } from './appUpdate';
import { Button } from './components/ui';
import { MONO, useTheme } from './theme';

// Something going wrong in the app's JS does not close it: it says what went wrong, to be copied to
// whoever looks for the cause.

export function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  // A place in the stack reads as its file alone: where the app is installed says nothing.
  const where = e.stack
    ?.split('\n')
    .slice(1, 9)
    .map((line) => line.replace(/[^\s(]*\/([^/\s)]+:\d+:\d+)/, '$1'))
    .join('\n');
  return `${e.name}: ${e.message}${where ? `\n${where}` : ''}`;
}

let showing = false;

// Thrown outside drawing (a socket, a timer, a press) and caught by nothing: told, one at a time, and the
// app carries on. While developing, React Native's own red screen tells it instead.
export function sayUncaughtErrors() {
  if (__DEV__) return;
  ErrorUtils.setGlobalHandler((e) => {
    if (showing) return;
    showing = true;
    const text = errorText(e);
    const done = () => {
      showing = false;
    };
    Alert.alert(t.appError, text, [
      { text: t.copy, onPress: () => void Clipboard.setStringAsync(text).finally(done) },
      { text: t.close, style: 'cancel', onPress: done },
    ]);
  });
}

// Thrown while drawing: in place of the app, what went wrong and the way back in. Updates still arrive
// here, so a version that fixes it can.
export function ErrorScreen({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const { c, fs } = useTheme();
  const [copied, setCopied] = useState(false);
  useAppUpdates();
  const text = errorText(error);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingHorizontal: 20, paddingTop: 96, paddingBottom: 40, gap: 16 }}>
      <Text style={{ color: c.text, fontSize: fs(22), fontWeight: '600' }}>{t.appError}</Text>
      <ScrollView style={{ flexGrow: 0, maxHeight: 360, borderRadius: 12, backgroundColor: c.surface2 }} contentContainerStyle={{ padding: 14 }}>
        <Text selectable style={{ color: c.text, fontFamily: MONO, fontSize: fs(12), lineHeight: fs(12) * 1.5 }}>
          {text}
        </Text>
      </ScrollView>
      <Button kind="primary" label={t.reopen} onPress={() => void Updates.reloadAsync().catch(() => retry())} />
      <Button
        label={copied ? t.copied : t.copy}
        onPress={() => void Clipboard.setStringAsync(text).then(() => setCopied(true), () => {})}
      />
    </View>
  );
}
