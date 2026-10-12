import { agentOf, isAgent, type RecentConversation, type TermSession } from '@workoffdesk/client/base/api';
import { dirName, listTime, sessionPreview, shortPath } from '@workoffdesk/client/model/format';
import { t } from '@workoffdesk/i18n';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { ActionSheetIOS, Pressable, StyleSheet, Text, View } from 'react-native';
import { tint, type Theme } from '../theme';
import { SwipeRow } from './SwipeRow';

// neutral: grey beside the main action.
export type RowAction = { label: string; run: () => void; destructive?: boolean; neutral?: boolean };

// A session here. It slides left to show its actions, as on the web, and a long press opens them in a sheet;
// VoiceOver has them as its actions. open: whether it is the one row the list has open; a tap on an open row
// shuts it rather than opening the session. A past one is drawn as a conversation on the Mac is, with no status:
// nothing runs in it.
type OpenRow = { open: boolean; setOpen: Dispatch<SetStateAction<string | null>>; holdScroll: () => () => void };
export function Row({ s, folder, unread, theme, actions, open, setOpen, holdScroll }: { s: TermSession; folder: string | null; unread: boolean; theme: Theme; actions: RowAction[] } & OpenRow) {
  const st = useMemo(() => rowStyles(theme), [theme]);
  const { c } = theme;
  const status = isAgent(s.kind) && !s.past ? s.status : null;
  const hold = () => {
    const destructive = actions.findIndex((a) => a.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: s.title, options: [...actions.map((a) => a.label), t.cancel], cancelButtonIndex: actions.length, destructiveButtonIndex: destructive < 0 ? undefined : destructive },
      (i) => actions[i]?.run(),
    );
  };
  return (
    <SwipeRow id={s.id} open={open} setOpen={setOpen} holdScroll={holdScroll} actions={actions} theme={theme}>
      <Pressable
        testID="session-card"
        accessibilityRole="button"
        onPress={() => (open ? setOpen(null) : router.push({ pathname: '/session/[id]', params: { id: s.id } }))}
        onLongPress={hold}
        accessibilityActions={actions.map((a, i) => ({ name: String(i), label: a.label }))}
        onAccessibilityAction={(e) => actions[Number(e.nativeEvent.actionName)]?.run()}
        style={({ pressed }) => [st.item, pressed && { backgroundColor: c.rowHeld }]}
      >
        <View style={[st.avatar, s.past && st.macAvatar, { backgroundColor: s.kind === 'codex' ? c.codex : isAgent(s.kind) ? c.claude : c.shell }]}>
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
            {s.past ? s.lastReply || shortPath(s.cwd) : sessionPreview(s)}
          </Text>
        </View>
      </Pressable>
    </SwipeRow>
  );
}

// A Claude or Codex conversation on the Mac, opened to read before picking it up here. One still open in a
// terminal there is drawn as a session here is, with what the agent does in it; the line under it is what was
// said last.
export function MacRow({ r, theme }: { r: RecentConversation; theme: Theme }) {
  const st = useMemo(() => rowStyles(theme), [theme]);
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

export const rowStyles = ({ c, fs }: Theme) =>
  StyleSheet.create({
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
  });
