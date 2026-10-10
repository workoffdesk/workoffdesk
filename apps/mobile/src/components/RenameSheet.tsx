import type { TermSession } from '@workoffdesk/client/base/api';
import { dirName } from '@workoffdesk/client/model/format';
import { t } from '@workoffdesk/i18n';
import { useMemo } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../client';
import { useRename } from '@workoffdesk/react/rename';
import { useTheme, type Theme } from '../theme';
import { Button, CloseButton } from './ui';

export function RenameSheet({ session, onClose }: { session: TermSession; onClose: () => void }) {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const { name, setName, busy, canSave, error, save } = useRename(api, session, onClose);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.sheet}>
        <View style={s.head}>
          <Text style={s.title}>{t.rename}</Text>
          <CloseButton onPress={onClose} />
        </View>
        {error && <Text style={s.alert}>{error}</Text>}
        <View style={s.form}>
          <TextInput
            style={s.input}
            accessibilityLabel={t.name}
            placeholder={dirName(session.cwd)}
            placeholderTextColor={theme.c.muted}
            value={name}
            onChangeText={setName}
            returnKeyType="done"
            onSubmitEditing={() => void save()}
            autoFocus
            autoCorrect={false}
          />
          <Button small kind="primary" label={t.save} busy={busy} disabled={!canSave} onPress={() => void save()} />
        </View>
        <Text style={s.note}>{t.renameNote}</Text>
      </View>
    </Modal>
  );
}

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    sheet: { flex: 1, backgroundColor: c.surface, padding: 16, gap: 12 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { flex: 1, fontSize: fs(17), fontWeight: '700', color: c.text },
    alert: { color: c.danger, fontSize: fs(14) },
    form: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    input: { flex: 1, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg, fontSize: Math.max(16, fs(16)), color: c.text },
    note: { fontSize: fs(13), color: c.muted },
  });
