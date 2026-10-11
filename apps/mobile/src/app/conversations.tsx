import { t } from '@workoffdesk/i18n';
import { useMacHistory } from '@workoffdesk/react/macHistory';
import { Stack } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { api } from '../client';
import { MacRow, rowStyles } from '../components/rows';
import { useTheme, type Theme } from '../theme';

// Every Claude and Codex conversation on the Mac that no session here holds, by day, searched as it is typed;
// more come as the list is scrolled to its end. A row opens the conversation to read before picking it up.
export default function Conversations() {
  const theme = useTheme();
  const st = useMemo(() => styles(theme), [theme]);
  const rs = useMemo(() => rowStyles(theme), [theme]);
  const { history, days, rows, q, loading, error, more } = useMacHistory(api);
  const sections = days.map((d) => ({ title: d.title, data: d.rows }));

  const empty = loading ? null : error ? null : (
    <Text style={st.center}>{q.trim() ? t.notFound(q.trim()) : t.noConversations}</Text>
  );
  const footer = loading ? (
    <ActivityIndicator style={st.spinner} color={theme.c.muted} />
  ) : error ? (
    <Pressable accessibilityRole="button" onPress={() => (rows.length ? history.loadMore() : history.reload())} style={st.retry}>
      <Text style={st.error}>{error}</Text>
      <Text style={st.retryLabel}>{t.tryAgain}</Text>
    </Pressable>
  ) : null;

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: t.search,
            onChangeText: (e) => history.search(e.nativeEvent.text),
            hideWhenScrolling: false,
          },
        }}
      />
      <SectionList
        style={st.list}
        contentInsetAdjustmentBehavior="automatic"
        sections={sections}
        keyExtractor={(r) => r.sessionId}
        renderItem={({ item }) => <MacRow r={item} theme={theme} />}
        renderSectionHeader={({ section }) => <Text style={rs.group}>{section.title}</Text>}
        ItemSeparatorComponent={() => <View style={rs.rule} />}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={() => more && history.loadMore()}
        onEndReachedThreshold={0.5}
        keyboardDismissMode="on-drag"
      />
    </>
  );
}

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    list: { flex: 1, backgroundColor: c.bg },
    center: { textAlign: 'center', color: c.muted, fontSize: fs(15), paddingVertical: 40 },
    spinner: { paddingVertical: 24 },
    retry: { alignItems: 'center', gap: 6, paddingVertical: 24, paddingHorizontal: 16 },
    error: { color: c.danger, fontSize: fs(14), textAlign: 'center' },
    retryLabel: { color: c.accent, fontSize: fs(15), fontWeight: '600' },
  });
