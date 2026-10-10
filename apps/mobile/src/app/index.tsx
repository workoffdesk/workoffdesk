import { agentOf, isAgent, type RecentConversation, type TermSession } from '@workoffdesk/client/base/api';
import { dirName, listTime, sessionPreview, shortPath } from '@workoffdesk/client/model/format';
import { folderBeside, listView } from '@workoffdesk/client/sessions/sessionListView';
import { t } from '@workoffdesk/i18n';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { followMacRecent, keptMacRecent, macShown } from '@workoffdesk/client/sessions/macRecent';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useUpdateReady } from '../appUpdate';
import { api, seen, storage, visibility } from '../client';
import { RenameSheet } from '../components/RenameSheet';
import { useSessions } from '../hooks';
import { tint, useTheme, type Theme } from '../theme';
import { bareHeader } from '../components/header';

type Section = { cwd: string; title: string | null; data: TermSession[] };

// Claude and Codex conversations people had on this Mac lately and not opened here (macRecent.ts); asked
// again whenever a session here starts or stops following one.
function useMacSessions(sessions: TermSession[] | null): RecentConversation[] {
  const [recent, setRecent] = useState(() => macShown(keptMacRecent(storage), Date.now()));
  const followed = (sessions ?? []).flatMap((s) => s.claudeSessionId ?? s.codexThreadId ?? []).sort().join(' ');
  useEffect(() => followMacRecent({ api, storage, visibility }, (all) => setRecent(macShown(all, Date.now()))), [followed]);
  return recent;
}

// A long press renames the session, as a swipe does on the web.
function Row({ s, folder, unread, theme, onRename }: { s: TermSession; folder: string | null; unread: boolean; theme: Theme; onRename: () => void }) {
  const st = useMemo(() => styles(theme), [theme]);
  const { c } = theme;
  const status = isAgent(s.kind) ? s.status : null;
  return (
    <Pressable
      testID="session-card"
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/session/[id]', params: { id: s.id } })}
      onLongPress={onRename}
      accessibilityActions={[{ name: 'rename', label: t.renameAction }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'rename' && onRename()}
      style={({ pressed }) => [st.item, pressed && { backgroundColor: c.rowHeld }]}
    >
      <View style={[st.avatar, { backgroundColor: s.kind === 'codex' ? c.codex : isAgent(s.kind) ? c.claude : c.shell }]}>
        <SymbolView
          name={s.kind === 'codex' ? 'chevron.left.forwardslash.chevron.right' : isAgent(s.kind) ? 'bubble.left' : 'terminal'}
          tintColor="#fff"
          size={s.kind === 'codex' ? 22 : 26}
        />
        {status === 'waiting' && <View style={[st.needsYou, { borderColor: c.row }]} />}
        {status === 'working' && <View style={[st.busy, { borderColor: c.row, backgroundColor: c.accent }]} />}
      </View>
      <View style={st.main}>
        <View style={st.top}>
          {status === 'working' && <Text style={[st.badge, { color: c.working, backgroundColor: tint(c.working, 16) }]}>{t.busy}</Text>}
          {status === 'waiting' && <Text style={[st.badge, { color: c.waiting, backgroundColor: tint(c.waiting, 16) }]}>{t.needsYou}</Text>}
          {unread && status !== 'working' && status !== 'waiting' && (
            <Text style={[st.badge, { color: c.accentText, backgroundColor: c.accent }]}>{t.unread}</Text>
          )}
          <Text style={st.name} numberOfLines={1}>
            {s.title}
          </Text>
          {!!folder && (
            <Text style={st.dir} numberOfLines={1}>
              {folder}
            </Text>
          )}
          <Text style={st.time}>{listTime(s.lastActivity)}</Text>
        </View>
        <Text style={st.preview} numberOfLines={1}>
          {sessionPreview(s)}
        </Text>
      </View>
    </Pressable>
  );
}

// A Claude or Codex conversation on the Mac, opened to read before picking it up here. One still open in a
// terminal there is drawn as a session here is, with what the agent does in it; the line under it is what was
// said last.
function MacRow({ r, theme }: { r: RecentConversation; theme: Theme }) {
  const st = useMemo(() => styles(theme), [theme]);
  const { c } = theme;
  const status = r.onMac?.status;
  const terminals = r.onMac?.terminals ?? 0;
  const codex = agentOf(r) === 'codex';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: codex ? '/codex/[sid]' : '/claude/[sid]', params: { sid: r.sessionId } })}
      style={({ pressed }) => [st.item, pressed && { backgroundColor: c.rowHeld }]}
    >
      <View style={[st.avatar, !status && st.macAvatar, { backgroundColor: codex ? c.codex : c.claude }]}>
        <SymbolView name={codex ? 'chevron.left.forwardslash.chevron.right' : 'bubble.left'} tintColor="#fff" size={codex ? 22 : 26} />
        {status === 'waiting' && <View style={[st.needsYou, { borderColor: c.row }]} />}
        {status === 'busy' && <View style={[st.busy, { borderColor: c.row, backgroundColor: c.accent }]} />}
      </View>
      <View style={st.main}>
        <View style={st.top}>
          {status === 'busy' && <Text style={[st.badge, { color: c.working, backgroundColor: tint(c.working, 16) }]}>{t.busy}</Text>}
          {status === 'waiting' && <Text style={[st.badge, { color: c.waiting, backgroundColor: tint(c.waiting, 16) }]}>{t.needsYou}</Text>}
          {terminals > 1 && <Text style={[st.badge, { color: c.danger, backgroundColor: tint(c.danger, 16) }]}>{t.openInTerminals(terminals)}</Text>}
          <Text style={st.name} numberOfLines={1}>
            {r.title}
          </Text>
          {!!r.cwd && (
            <Text style={st.dir} numberOfLines={1}>
              {dirName(r.cwd)}
            </Text>
          )}
          <Text style={st.time}>{listTime(r.lastActivity)}</Text>
        </View>
        <Text style={st.preview} numberOfLines={1}>
          {r.lastPrompt ?? shortPath(r.cwd ?? '')}
        </Text>
      </View>
    </Pressable>
  );
}

export default function Sessions() {
  const theme = useTheme();
  const updateReady = useUpdateReady();
  const st = useMemo(() => styles(theme), [theme]);
  const sessions = useSessions();
  const mac = useMacSessions(sessions ?? null);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<TermSession | null>(null);
  const { sorted, groups } = listView(sessions ?? null, query);
  const unread = sorted ? seen.unreadOf(sorted) : new Set<string>();
  const sections: Section[] = groups.map((g) => ({ cwd: g.cwd, title: g.title, data: g.sessions }));

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
            right: { type: 'button', label: t.newSession, icon: { type: 'sfSymbol', name: 'plus' }, onPress: () => router.push('/new-session') },
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
        renderItem={({ item, section }) => <Row s={item} folder={folderBeside(item, section.title)} unread={unread.has(item.id)} theme={theme} onRename={() => setRenaming(item)} />}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <Text style={st.group}>
              {section.title} <Text style={st.groupCount}>{section.data.length}</Text>
            </Text>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={st.rule} />}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={empty}
        ListFooterComponent={
          mac.length > 0 && !query.trim() ? (
            <View>
              <Text style={st.group}>
                {t.otherMacSessions} <Text style={st.groupCount}>{mac.length}</Text>
              </Text>
              {mac.map((r, i) => (
                <View key={r.sessionId}>
                  {i > 0 && <View style={st.rule} />}
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
    item: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 72, paddingHorizontal: 16, backgroundColor: c.row },
    avatar: { width: 48, height: 48, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    macAvatar: { opacity: 0.55 },
    needsYou: { position: 'absolute', top: -4, right: -4, width: 12, height: 12, borderRadius: 6, backgroundColor: c.needsYou, borderWidth: 1.5 },
    busy: { position: 'absolute', right: -4, bottom: -4, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
    main: { flex: 1, minWidth: 0, gap: 3 },
    top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    badge: { fontSize: fs(11), fontWeight: '600', paddingVertical: 1, paddingHorizontal: 6, borderRadius: 6, overflow: 'hidden' },
    name: { flex: 1, minWidth: 0, fontSize: fs(17), color: c.text },
    dir: { flexShrink: 1, maxWidth: '40%', fontSize: fs(13), color: c.muted },
    time: { fontSize: fs(12), color: c.muted },
    preview: { fontSize: fs(14), color: c.muted },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 76 },
    group: { fontSize: fs(15), fontWeight: '600', color: c.text, paddingTop: 18, paddingBottom: 6, paddingHorizontal: 16, backgroundColor: c.bg },
    groupCount: { fontWeight: '400', color: c.muted },
    hint: { fontSize: fs(12), color: c.muted, paddingTop: 8, paddingBottom: 24, paddingHorizontal: 16 },
    center: { textAlign: 'center', color: c.muted, fontSize: fs(15), paddingVertical: 40 },
    empty: { alignItems: 'center', gap: 10, paddingVertical: 56, paddingHorizontal: 16, opacity: 0.9 },
    emptyTitle: { color: c.text, fontSize: fs(17), fontWeight: '600' },
    emptySub: { color: c.muted, fontSize: fs(14), textAlign: 'center' },
  });
