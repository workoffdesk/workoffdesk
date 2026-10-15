import { rows, turns } from '@workoffdesk/client/model/chat';
import { ClaudeConversation } from '@workoffdesk/react/claudeConversation';
import { t } from '@workoffdesk/i18n';
import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useChat } from '../hooks';
import { useTheme, type Theme } from '../theme';
import { ToolsRow, TurnView } from './Turn';

type Entry = { key: string; node: ReactNode };

// A conversation read from its transcript, which nothing is sent to: the latest at the bottom, following what
// is written, and earlier turns as it is scrolled up. `conversation` is the Claude conversation its sub-agents
// are found under, when it is one.
export function ReadChat({ id, url, conversation }: { id: string; url: string; conversation: string | null }) {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const { chat, failed, loadingOlder, loadOlder } = useChat(id, url);
  const shown = useMemo(() => (chat ? turns(chat.items, chat.base) : []), [chat]);
  const drawn = rows(shown);
  const entries: Entry[] = drawn.map((r, n) => {
    if (r.k === 'tools') {
      const next = drawn[n + 1];
      const end = next?.k === 'one' && 'at' in next.t ? next.t.at : undefined;
      return { key: r.key, node: <ToolsRow sessionId={id} tools={r.tools} going={r.going} end={end} /> };
    }
    return { key: r.t.key, node: <TurnView sessionId={id} t={r.t} /> };
  });
  if (failed) entries.push({ key: 'failed', node: <Text style={s.note}>{t.cannotRead}</Text> });
  entries.reverse();

  return (
    <ClaudeConversation value={conversation}>
      <FlatList
        style={s.list}
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
    </ClaudeConversation>
  );
}

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    list: { flex: 1, backgroundColor: c.bg },
    content: { paddingHorizontal: 14, paddingVertical: 12 },
    entry: { paddingVertical: 7 },
    older: { paddingVertical: 12 },
    reading: { color: c.muted, fontSize: fs(14), textAlign: 'center', paddingVertical: 40 },
    note: { alignSelf: 'center', textAlign: 'center', fontSize: fs(12), lineHeight: fs(18), color: c.muted },
  });
