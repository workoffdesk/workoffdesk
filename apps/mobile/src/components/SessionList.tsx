import { errorText, type RecentConversation, type TermSession } from '@workoffdesk/client/base/api';
import { leaveSession } from '@workoffdesk/client/sessions/leave';
import { followMacRecent, keptMacRecent, macShown, notGoneOnHere } from '@workoffdesk/client/sessions/macRecent';
import { isDemo } from '@workoffdesk/client/demo/account';
import { pinAction } from '@workoffdesk/client/sessions/pin';
import { folderBeside, listView, type SessionGroup } from '@workoffdesk/client/sessions/sessionListView';
import { t } from '@workoffdesk/i18n';
import { useGrouping } from '@workoffdesk/react/settings';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useUpdateReady } from '../appUpdate';
import { api, auth, groupingChoice, seen, sessionList, storage, visibility } from '../client';
import { useLogin, useSessions } from '../hooks';
import { scrollHolds } from '../scrollHold';
import { useTheme, type Theme } from '../theme';
import { RenameSheet } from './RenameSheet';
import { MacRow, Row, rowStyles, type RowAction } from './rows';

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
const pinRow = (s: TermSession): RowAction => {
  const pin = pinAction(api, s);
  return { label: pin.label, run: () => void pin.run().then((why) => why && Alert.alert(why)) };
};
const confirmDelete = (s: TermSession) =>
  Alert.alert(t.deleteSessionTitle, t.deleteSessionSub, [
    { text: t.cancel, style: 'cancel' },
    { text: t.delete, style: 'destructive', onPress: () => leave(s) },
  ]);

// The sessions here and, under them, the conversations on the Mac, found by query. current: the id of the
// one open beside the list, drawn as held.
export function SessionList({ query, current = null }: { query: string; current?: string | null }) {
  const theme = useTheme();
  const st = useMemo(() => styles(theme), [theme]);
  const rs = useMemo(() => rowStyles(theme), [theme]);
  const sessions = useSessions();
  const demo = isDemo(useLogin());
  const mac = useMacSessions(sessions ?? null);
  const [renaming, setRenaming] = useState<TermSession | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const [holdScroll] = useState(() => scrollHolds(setHeld));
  const { grouping } = useGrouping(groupingChoice);
  const { sorted, groups } = listView(sessions ?? null, query, grouping);
  const unread = sorted ? seen.unreadOf(sorted) : new Set<string>();
  const sections: Section[] = groups.map((g) => ({ group: g, title: g.title, data: g.sessions }));
  const actions = (s: TermSession): RowAction[] => [
    pinRow(s),
    { label: t.renameAction, neutral: true, run: () => setRenaming(s) },
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
      <SectionList
        style={st.list}
        scrollEnabled={!held}
        contentInsetAdjustmentBehavior="automatic"
        sections={sections}
        keyExtractor={(s) => s.id}
        renderItem={({ item, section }) => (
          <Row
            s={item}
            folder={folderBeside(item, section.group)}
            unread={unread.has(item.id)}
            current={item.id === current}
            theme={theme}
            actions={actions(item)}
            open={openId === item.id}
            setOpen={setOpenId}
            holdScroll={holdScroll}
          />
        )}
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
        ListHeaderComponent={
          demo ? (
            <View style={st.demo} accessibilityRole="summary">
              <Text style={st.demoText}>{t.demoBanner}</Text>
              <Pressable hitSlop={8} accessibilityRole="button" onPress={() => void auth.signOut()}>
                <Text style={st.demoGo}>{t.connectMyMac}</Text>
              </Pressable>
            </View>
          ) : null
        }
        ListFooterComponent={
          mac.length > 0 && !query.trim() ? (
            <View>
              <Text style={rs.group}>
                {t.otherMacSessions} <Text style={rs.groupCount}>{mac.length}</Text>
              </Text>
              {mac.map((r, i) => (
                <View key={r.sessionId}>
                  {i > 0 && <View style={rs.rule} />}
                  <MacRow r={r} current={r.sessionId === current} theme={theme} />
                </View>
              ))}
              <Text style={st.hint}>{t.startInTmuxHint}</Text>
            </View>
          ) : null
        }
        onScrollBeginDrag={() => setOpenId(null)}
        keyboardDismissMode="on-drag"
      />
      {renaming && <RenameSheet session={renaming} onClose={() => setRenaming(null)} />}
    </>
  );
}

// The way to Settings. A new version waiting is marked on it, as iOS marks its own: on the gear's corner,
// where the bar's own badge does not go.
export function GearButton() {
  const theme = useTheme();
  const st = useMemo(() => styles(theme), [theme]);
  const updateReady = useUpdateReady();
  return (
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
    demo: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: 16, padding: 12, borderRadius: 12, backgroundColor: c.surface },
    demoText: { flexShrink: 1, color: c.text, fontSize: fs(14) },
    demoGo: { color: c.accent, fontSize: fs(14), fontWeight: '600' },
    hint: { fontSize: fs(12), color: c.muted, paddingTop: 8, paddingBottom: 24, paddingHorizontal: 16 },
    center: { textAlign: 'center', color: c.muted, fontSize: fs(15), paddingVertical: 40 },
    empty: { alignItems: 'center', gap: 10, paddingVertical: 56, paddingHorizontal: 16, opacity: 0.9 },
    emptyTitle: { color: c.text, fontSize: fs(17), fontWeight: '600' },
    emptySub: { color: c.muted, fontSize: fs(14), textAlign: 'center' },
  });
