import { agentName, type Agent } from '@workoffdesk/client/base/api';
import { rows, turns } from '@workoffdesk/client/model/chat';
import { shortPath, timeAgo } from '@workoffdesk/client/model/format';
import { keptConversation } from '@workoffdesk/client/sessions/macRecent';
import { onMacSays, previewChatUrl } from '@workoffdesk/client/sessions/newSession';
import { useMacConversation } from '@workoffdesk/react/macConversation';
import { t } from '@workoffdesk/i18n';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, storage } from '../client';
import { useChat } from '../hooks';
import { MONO, useTheme, type Theme } from '../theme';
import { PageHeader } from './header';
import { ToolsRow, TurnView } from './Turn';
import { Button } from './ui';

type Entry = { key: string; node: ReactNode };

// A Claude or Codex conversation from this Mac, read before picking it up here; nothing on it is sent to the
// agent.
export function MacConversation({ agent }: { agent: Agent }) {
  const { sid } = useLocalSearchParams<{ sid: string }>();
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { chat, failed, loadingOlder, loadOlder } = useChat(`${agent}:${sid}`, previewChatUrl(agent, sid));
  const [kept] = useState(() => keptConversation(storage, sid));
  const go = (id: string) => navigation.isFocused() && router.replace({ pathname: '/session/[id]', params: { id } });
  const { info, busy, error, unreachable, pick, waiting, missed, resume, takeOverNow, takeOverWhenDone, cancel } = useMacConversation(api, agent, sid, go, kept);

  const shown = useMemo(() => (chat ? turns(chat.items, chat.base) : []), [chat]);
  const drawn = rows(shown);
  const entries: Entry[] = drawn.map((r, n) => {
    if (r.k === 'tools') {
      const next = drawn[n + 1];
      const end = next?.k === 'one' && 'at' in next.t ? next.t.at : undefined;
      return { key: r.key, node: <ToolsRow sessionId={sid} tools={r.tools} going={r.going} end={end} /> };
    }
    return { key: r.t.key, node: <TurnView sessionId={sid} t={r.t} /> };
  });
  if (failed) entries.push({ key: 'failed', node: <Text style={s.note}>{t.cannotRead}</Text> });
  entries.reverse();

  return (
    <View style={s.page}>
      <PageHeader
        title={
          <View style={s.title}>
            <Text style={s.titleText} numberOfLines={1}>
              {info?.title ?? t.macSession}
            </Text>
            {info && (
              <Text style={s.titleSub} numberOfLines={1}>
                {`${shortPath(info.cwd ?? '')} · ${timeAgo(info.lastActivity)}`}
              </Text>
            )}
          </View>
        }
        right={<Text style={s.chip}>{t.readOnly}</Text>}
      />
      <FlatList
        style={s.page}
        inverted
        data={entries}
        keyExtractor={(e) => e.key}
        renderItem={({ item }) => <View style={s.entry}>{item.node}</View>}
        onEndReached={() => void loadOlder()}
        onEndReachedThreshold={1}
        contentContainerStyle={s.content}
        ListEmptyComponent={!chat && !failed ? <Text style={s.reading}>{t.reading}</Text> : null}
        ListFooterComponent={loadingOlder ? <ActivityIndicator style={s.older} accessibilityLabel={t.loadingEarlier} color={theme.c.muted} /> : null}
      />
      <View style={[s.foot, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {error && <Text style={s.alert}>{error}</Text>}
        {unreachable && !error && <Text style={s.alert}>{t.noServer}</Text>}
        {missed && !error && <Text style={s.alert}>{t.takeOverMissed}</Text>}
        {info === null && <Text style={s.alert}>{t.notOnMac}</Text>}
        {pick?.do === 'takeOver' && (
          <View style={s.onMac}>
            <View style={[s.dot, { backgroundColor: pick.status === 'busy' ? theme.c.working : pick.status === 'waiting' ? theme.c.waiting : theme.c.idle }]} />
            <Text style={s.onMacText}>
              {[onMacSays(pick.status), pick.terminals > 1 && t.openInTerminals(pick.terminals)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        )}
        {pick?.do === 'takeOver' && waiting ? (
          <>
            <Text style={s.waitText}>{t.takingOverWait}</Text>
            <Button kind="primary" label={t.takeOverInterrupt} busy={busy} onPress={takeOverNow} />
            <Button label={t.takeOverCancel} disabled={busy} onPress={cancel} />
          </>
        ) : pick?.do === 'takeOver' ? (
          <>
            {pick.status === 'background' && <Text style={s.waitText}>{t.takeOverStopsCommands}</Text>}
            {(pick.status === 'idle' || pick.status === 'background') && <Button kind="primary" label={t.takeOverNow} busy={busy} onPress={takeOverNow} />}
            {pick.status === 'busy' && <Button kind="primary" label={t.takeOverWhenDone} busy={busy} onPress={takeOverWhenDone} />}
            {pick.status === 'busy' && <Button label={t.takeOverInterrupt} disabled={busy} onPress={takeOverNow} />}
            {pick.status === 'waiting' && <Text style={s.waitText}>{t.takeOverDropsQuestion}</Text>}
            {pick.status === 'waiting' && <Button kind="primary" label={t.takeOverNow} busy={busy} onPress={takeOverNow} />}
            <Text style={s.note}>
              {t.takeOverNote(agentName(agent))}
              {'\n'}
              {t.backAtMac}
              <Text style={s.code}>workoffdesk attach</Text>
            </Text>
          </>
        ) : pick?.do === 'gone' ? (
          <>
            <Button kind="primary" label={t.folderGoneNoResume} disabled onPress={() => {}} />
            <Text style={s.note}>{t.folderGoneSub(shortPath(info?.cwd ?? ''))}</Text>
          </>
        ) : (
          <Button
            kind="primary"
            label={pick?.do === 'open' ? t.openAlreadyOnPhone : pick?.do === 'none' ? (agent === 'codex' ? t.openElsewhereNoResume : t.inBackgroundNoResume) : t.continueOnPhone}
            disabled={busy || !info?.cwd || !pick || pick.do === 'none'}
            busy={busy || info === undefined}
            onPress={() => (pick?.do === 'open' ? go(pick.id) : void resume())}
          />
        )}
      </View>
    </View>
  );
}

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.bg },
    title: { alignItems: 'center', maxWidth: 220 },
    titleText: { fontSize: fs(16), fontWeight: '600', color: c.text },
    chip: { fontSize: fs(12), color: c.muted, backgroundColor: c.surface2, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 8, overflow: 'hidden' },
    titleSub: { fontSize: fs(11), color: c.muted },
    content: { paddingHorizontal: 14, paddingVertical: 12 },
    entry: { paddingVertical: 7 },
    older: { paddingVertical: 12 },
    reading: { color: c.muted, fontSize: fs(14), textAlign: 'center', paddingVertical: 40 },
    note: { alignSelf: 'center', textAlign: 'center', fontSize: fs(12), lineHeight: fs(18), color: c.muted },
    code: { fontFamily: MONO, color: c.text },
    foot: { gap: 10, paddingTop: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, backgroundColor: c.bg },
    alert: { textAlign: 'center', color: c.danger, fontSize: fs(14) },
    onMac: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    onMacText: { color: c.muted, fontSize: fs(13), fontWeight: '500' },
    waitText: { alignSelf: 'center', textAlign: 'center', color: c.muted, fontSize: fs(14) },
  });
