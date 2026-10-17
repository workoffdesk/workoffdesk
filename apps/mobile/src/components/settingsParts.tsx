import { t } from '@workoffdesk/i18n';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { clearKept, snippets } from '../client';
import { keptBytes } from '../keptOnPhone';
import { tint, type Theme } from '../theme';
import { Button } from './ui';

// The parts of the settings page, and how they look.

export type SettingsStyles = ReturnType<typeof settingsStyles>;

export function Section({ title, children, s }: { title: string; children: ReactNode; s: SettingsStyles }) {
  return (
    <View style={s.section}>
      <Text style={s.h2}>{title}</Text>
      <View style={s.group}>{children}</View>
    </View>
  );
}

export function Snippets({ s, theme }: { s: SettingsStyles; theme: Theme }) {
  const [text, setText] = useState(snippets.text);
  return (
    <Section title={t.snippets} s={s}>
      <TextInput
        style={s.snippets}
        accessibilityLabel={t.snippetsLines}
        placeholder={t.snippetsPlaceholder}
        placeholderTextColor={theme.c.muted}
        multiline
        value={text}
        onChangeText={(v) => {
          setText(v);
          snippets.set(v);
        }}
        autoCorrect={false}
      />
      <View style={s.rule} />
      <Text style={[s.row, s.sub]}>{t.snippetsNote}</Text>
    </Section>
  );
}

// How much the phone's copies of chats take, and a way to empty them.
export function Kept({ s }: { s: SettingsStyles }) {
  const [bytes, setBytes] = useState(keptBytes);
  const [clearing, setClearing] = useState(false);
  const clear = async () => {
    setClearing(true);
    try {
      await clearKept();
    } finally {
      setBytes(keptBytes());
      setClearing(false);
    }
  };
  return (
    <Section title={t.storage} s={s}>
      <View style={s.row}>
        <View style={s.rowMain}>
          <Text style={s.strong}>{t.keptChats}</Text>
          <Text style={s.sub}>{t.keptChatsSub(t.keptSize(bytes))}</Text>
        </View>
        <Button small label={t.clearKept} busy={clearing} disabled={bytes === 0} onPress={() => void clear()} />
      </View>
    </Section>
  );
}


export const settingsStyles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.bg },
    headerTitle: { fontSize: fs(17), fontWeight: '600', color: c.text },
    content: { padding: 16, paddingBottom: 40, gap: 22 },
    alert: { color: c.danger, fontSize: fs(15), padding: 12, borderRadius: 10, backgroundColor: tint(c.danger, 12), overflow: 'hidden' },
    section: { gap: 8 },
    h2: { fontSize: fs(13), fontWeight: '600', color: c.muted, paddingHorizontal: 4, textTransform: 'uppercase' },
    group: { borderRadius: 12, backgroundColor: c.surface, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 10, paddingHorizontal: 14 },
    rowMain: { flex: 1, gap: 2 },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    strong: { fontSize: fs(16), color: c.text },
    sub: { fontSize: fs(13), color: c.muted },
    failed: { fontSize: fs(13), color: c.danger },
    link: { fontSize: fs(16), color: c.accent },
    chip: { fontSize: fs(11), fontWeight: '600', color: c.idle, backgroundColor: tint(c.idle, 16), paddingVertical: 1, paddingHorizontal: 6, borderRadius: 6, overflow: 'hidden' },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    size: { minWidth: 48, textAlign: 'center', fontSize: fs(15), color: c.text, fontVariant: ['tabular-nums'] },
    preview: { fontSize: fs(15), color: c.text, lineHeight: fs(15) * 1.45 },
    snippets: { minHeight: 120, paddingVertical: 12, paddingHorizontal: 14, fontSize: Math.max(16, fs(16)), color: c.text, textAlignVertical: 'top' },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 14 },
    value: { fontSize: fs(16), color: c.muted },
  });
