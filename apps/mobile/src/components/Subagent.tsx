import { subagentChatUrl, subagentOf } from '@workoffdesk/client/sessions/subagent';
import { t } from '@workoffdesk/i18n';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../client';
import { useTheme, type Theme } from '../theme';
import { PageHeader } from './header';
import { ReadChat } from './ReadChat';

// What a sub-agent of a Claude conversation did, and is doing, from its own transcript; nothing is sent to it.
// Its own sub-agents are found under the same conversation.
export function Subagent() {
  const { sid, tool } = useLocalSearchParams<{ sid: string; tool: string }>();
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const [about, setAbout] = useState<string | null>(null);
  useEffect(() => {
    subagentOf(api, sid, tool).then(
      (a) => setAbout(a.description),
      () => setAbout(null),
    );
  }, [sid, tool]);

  return (
    <View style={s.page}>
      <PageHeader
        title={
          <Text style={s.title} numberOfLines={1}>
            {about ?? t.subagent}
          </Text>
        }
        right={<Text style={s.chip}>{t.readOnly}</Text>}
      />
      <ReadChat id={`claude:${sid}:${tool}`} url={subagentChatUrl(sid, tool)} conversation={sid} />
    </View>
  );
}

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.bg },
    title: { maxWidth: 220, fontSize: fs(16), fontWeight: '600', color: c.text },
    chip: { fontSize: fs(12), color: c.muted, backgroundColor: c.surface2, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 8, overflow: 'hidden' },
  });
