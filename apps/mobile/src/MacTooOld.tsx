import { MIN_SERVER, serverTooOld } from '@workoffdesk/client/base/release';
import { t } from '@workoffdesk/i18n';
import * as Clipboard from 'expo-clipboard';
import { useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, auth, release } from './client';
import { Button } from './components/ui';
import { MONO, useTheme } from './theme';

const UPGRADE = 'npm i -g workoffdesk@latest\nlaunchctl kickstart -k gui/$(id -u)/local.workoffdesk';

// The Mac's server is older than this app's JS works against: in place of the app, what to run on the Mac,
// until an answer names a release new enough.
export function MacTooOld() {
  const { c, fs } = useTheme();
  const mac = useSyncExternalStore(release.follow, release.current);
  const [copied, setCopied] = useState(false);
  if (!mac || !serverTooOld(mac)) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 96, paddingBottom: 40, gap: 16 }}>
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: fs(22), fontWeight: '600' }}>
          {t.macTooOld}
        </Text>
        <Text style={{ color: c.text, fontSize: fs(15), lineHeight: fs(15) * 1.45 }}>{t.macTooOldWhy(mac, MIN_SERVER)}</Text>
        <ScrollView horizontal style={{ flexGrow: 0, borderRadius: 12, backgroundColor: c.surface2 }} contentContainerStyle={{ padding: 14 }}>
          <Text selectable style={{ color: c.text, fontFamily: MONO, fontSize: fs(12), lineHeight: fs(12) * 1.6 }}>
            {UPGRADE}
          </Text>
        </ScrollView>
        <Button kind="primary" label={t.tryAgain} onPress={() => void api('/healthz').catch(() => {})} />
        <Button label={copied ? t.copied : t.copy} onPress={() => void Clipboard.setStringAsync(UPGRADE).then(() => setCopied(true), () => {})} />
        <Button label={t.logOut} onPress={() => void auth.signOut()} />
      </ScrollView>
    </View>
  );
}
