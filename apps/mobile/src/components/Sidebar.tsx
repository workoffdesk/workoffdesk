import { t } from '@workoffdesk/i18n';
import { router, usePathname } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type Theme } from '../theme';
import { GearButton, SessionList } from './SessionList';

// What is open beside the list: a session here, or a conversation on the Mac.
const openOf = (path: string) => path.match(/^\/(?:session|claude|codex)\/([^/]+)$/)?.[1] ?? null;

// The session list on the left of a wide screen, with the bar the list's own page has: Settings, the
// conversations on the Mac, a new session, and a search.
export function Sidebar({ width }: { width: number }) {
  const theme = useTheme();
  const st = useMemo(() => styles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const current = openOf(usePathname());
  const [query, setQuery] = useState('');
  return (
    <View style={[st.side, { width, paddingLeft: insets.left }]}>
      <View style={[st.bar, { paddingTop: insets.top }]}>
        <GearButton />
        <Text style={st.title} numberOfLines={1} accessibilityRole="header">
          {t.sessions}
        </Text>
        <BarButton icon="plus.circle" label={t.newSession} onPress={() => router.push('/new-session')} />
        <BarButton icon="clock.arrow.circlepath" label={t.conversationsOnMac} onPress={() => router.push('/conversations')} />
      </View>
      <TextInput
        style={st.search}
        placeholder={t.search}
        placeholderTextColor={theme.c.muted}
        value={query}
        onChangeText={setQuery}
        clearButtonMode="while-editing"
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
      />
      <SessionList query={query} current={current} />
    </View>
  );
}

function BarButton({ icon, label, onPress }: { icon: SymbolViewProps['name']; label: string; onPress: () => void }) {
  const theme = useTheme();
  const st = useMemo(() => styles(theme), [theme]);
  return (
    <Pressable style={st.button} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <SymbolView name={icon} tintColor={theme.c.text} size={24} />
    </Pressable>
  );
}

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    side: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.border, backgroundColor: c.bg },
    bar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingBottom: 6, backgroundColor: c.bg },
    title: { flex: 1, fontSize: fs(17), fontWeight: '600', color: c.text, textAlign: 'center' },
    button: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
    search: {
      marginHorizontal: 12,
      marginBottom: 8,
      paddingHorizontal: 12,
      height: 36,
      borderRadius: 10,
      backgroundColor: c.surface2,
      color: c.text,
      fontSize: fs(16),
    },
  });
