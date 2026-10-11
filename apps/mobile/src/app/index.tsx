import { errorText, type RecentConversation, type TermSession } from '@workoffdesk/client/base/api';
import { leaveSession } from '@workoffdesk/client/sessions/leave';
import { folderBeside, listView, type SessionGroup } from '@workoffdesk/client/sessions/sessionListView';
import { t } from '@workoffdesk/i18n';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { followMacRecent, keptMacRecent, macShown, notGoneOnHere } from '@workoffdesk/client/sessions/macRecent';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useUpdateReady } from '../appUpdate';
import { api, seen, sessionList, storage, visibility } from '../client';
import { RenameSheet } from '../components/RenameSheet';
import { useSessions } from '../hooks';
import { MacRow, Row, rowStyles, type RowAction } from '../components/rows';
import { useTheme, type Theme } from '../theme';
import { bareHeader } from '../components/header';

type Section = { group: SessionGroup; title: string | null; data: TermSession[] };

// Claude and Codex conversations people had on this Mac lately and not opened here (macRecent.ts); asked
// again whenever a session here starts or stops following one.
function useMacSessions(sessions: TermSession[] | null): RecentConversation[] {
  const [recent, setRecent] = useState(() => macShown(keptMacRecent(storage), Date.now()));
  const followed = (sessions ?? []).flatMap((s) => s.claudeSessionId ?? s.codexThreadId ?? []).sort().join(' ');
  useEffect(() => followMacRecent({ api, storage, visibility }, (all) => setRecent(macShown(all, Date.now()))), [followed]);
  return notGoneOnHere(recent, sessions ?? []);
}

// Ending or deleting a session from its row; what went wrong is said in an alert, as no page is there to say it.
const leave = (s: TermSession) =>
  void leaveSession(api, sessionList, s).catch((e: unknown) => Alert.alert(errorText(e, s.past ? t.deleteFailed : t.notEnded, s.past ? t.deleteFailed : t.endFailed)));
const confirmDelete = (s: TermSession) =>
  Alert.alert(t.deleteSessionTitle, t.deleteSessionSub, [
    { text: t.cancel, style: 'cancel' },
    { text: t.delete, style: 'destructive', onPress: () => leave(s) },
  ]);

export default function Sessions() {
  const theme = useTheme();
  const updateReady = useUpdateReady();
  const st = useMemo(() => styles(theme), [theme]);
  const rs = useMemo(() => rowStyles(theme), [theme]);
  const sessions = useSessions();
  const mac = useMacSessions(sessions ?? null);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<TermSession | null>(null);
  const { sorted, groups } = listView(sessions ?? null, query);
  const unread = sorted ? seen.unreadOf(sorted) : new Set<string>();
  const sections: Section[] = groups.map((g) => ({ group: g, title: g.title, data: g.sessions }));
  const actions = (s: TermSession): RowAction[] => [
    { label: t.renameAction, run: () => setRenaming(s) },
    s.past ? { label: t.delete, destructive: true, run: () => confirmDelete(s) } : { label: t.endSession, destructive: true, run: () => leave(s) },
  ];

  const empty = !sorted ? (
    <Text style={st.center}>{t.loading}</Text>
  ) : sorted.length === 0 ? (
    <View style={st.empty}>
      <SymbolView name="terminal" tintColor={theme.c.muted} size={44} />
      <Text style={st.emptyTitle}>{t.noSessions}</Text>
      <Text style={st.emptySub}>{t.noSessionsPhone}</Text>
    </View>
  ) : (
    <Text style={st.center}>{t.notFound(query.trim())}</Text>
  );

  return (
    <>
      <Stack.Screen
        options={{
          ...bareHeader({
            // A new version waiting is marked on the way to Settings, as iOS marks its own: on the gear's corner,
            // where the bar's own badge does not go.
            left: {
              type: 'custom',
              element: (
                <Pressable
                  style={st.gear}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={updateReady ? `${t.settings}, ${t.updateReady}` : t.settings}
                  onPress={() => router.push('/settings')}
                >
                  <SymbolView name="gearshape" tintColor={theme.c.text} size={GEAR} />
                  {updateReady && <Text style={st.gearBadge}>1</Text>}
                </Pressable>
              ),
            },
            // The bar's first item is its rightmost.
            right: [
              { type: 'button', label: t.newSession, icon: { type: 'sfSymbol', name: 'plus.circle' }, onPress: () => router.push('/new-session') },
              { type: 'button', label: t.conversationsOnMac, icon: { type: 'sfSymbol', name: 'clock.arrow.circlepath' }, onPress: () => router.push('/conversations') },
            ],
          }),
          headerSearchBarOptions: {
            placeholder: t.search,
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            hideWhenScrolling: false,
          },
        }}
      />
      <SectionList
        style={st.list}
        contentInsetAdjustmentBehavior="automatic"
        sections={sections}
        keyExtractor={(s) => s.id}
        renderItem={({ item, section }) => <Row s={item} folder={folderBeside(item, section.group)} unread={unread.has(item.id)} theme={theme} actions={actions(item)} />}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <Text style={rs.group}>
              {section.title} <Text style={rs.groupCount}>{section.data.length}</Text>
            </Text>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={rs.rule} />}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={empty}
        ListFooterComponent={
          mac.length > 0 && !query.trim() ? (
            <View>
              <Text style={rs.group}>
                {t.otherMacSessions} <Text style={rs.groupCount}>{mac.length}</Text>
              </Text>
              {mac.map((r, i) => (
                <View key={r.sessionId}>
                  {i > 0 && <View style={rs.rule} />}
                  <MacRow r={r} theme={theme} />
                </View>
              ))}
              <Text style={st.hint}>{t.startInTmuxHint}</Text>
            </View>
          ) : null
        }
        keyboardDismissMode="on-drag"
      />
      {renaming && <RenameSheet session={renaming} onClose={() => setRenaming(null)} />}
    </>
  );
}

// The size at which the gear draws as large as the bar's own gear did (23pt across).
const GEAR = 27;

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    gear: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    gearBadge: {
      position: 'absolute',
      top: 1,
      right: -1,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      paddingHorizontal: 4,
      overflow: 'hidden',
      backgroundColor: c.danger,
      color: '#fff',
      fontSize: 11,
      lineHeight: 16,
      fontWeight: '700',
      textAlign: 'center',
    },
    list: { flex: 1, backgroundColor: c.bg },
    hint: { fontSize: fs(12), color: c.muted, paddingTop: 8, paddingBottom: 24, paddingHorizontal: 16 },
    center: { textAlign: 'center', color: c.muted, fontSize: fs(15), paddingVertical: 40 },
    empty: { alignItems: 'center', gap: 10, paddingVertical: 56, paddingHorizontal: 16, opacity: 0.9 },
    emptyTitle: { color: c.text, fontSize: fs(17), fontWeight: '600' },
    emptySub: { color: c.muted, fontSize: fs(14), textAlign: 'center' },
  });
