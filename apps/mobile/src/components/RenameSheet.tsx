import type { TermSession } from '@workoffdesk/client/base/api';
import { dirName } from '@workoffdesk/client/model/format';
import { t } from '@workoffdesk/i18n';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Keyboard, LayoutAnimation, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, type KeyboardEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, sessionList } from '../client';
import { useRename } from '@workoffdesk/react/rename';
import { useTheme, type Theme } from '../theme';
import { Button } from './ui';

// A small dialog that rides up with the keyboard and sits on it. A save closes it at once.
export function RenameSheet({ session, onClose }: { session: TermSession; onClose: () => void }) {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const { name, setName, canSave, save } = useRename(api, sessionList, session, onClose, (why) => Alert.alert(why));
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[s.page, { paddingTop: insets.top + 12, paddingBottom: (keyboard || insets.bottom) + 12 }]} accessibilityViewIsModal>
        <Pressable style={[StyleSheet.absoluteFill, s.backdrop]} accessible={false} onPress={onClose} />
        <View style={s.card}>
          <Text style={s.title} accessibilityRole="header">
            {t.rename}
          </Text>
          <Text style={s.note}>{t.renameNote}</Text>
          <TextInput
            style={s.input}
            accessibilityLabel={t.name}
            placeholder={dirName(session.cwd)}
            placeholderTextColor={theme.c.muted}
            value={name}
            onChangeText={setName}
            returnKeyType="done"
            onSubmitEditing={save}
            autoFocus
            autoCorrect={false}
            clearButtonMode="while-editing"
            selectTextOnFocus
          />
          <View style={s.actions}>
            <Button label={t.cancel} onPress={onClose} style={s.action} />
            <Button kind="primary" label={t.save} disabled={!canSave} onPress={save} style={s.action} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// How much of the screen the keyboard covers, its changes moved as the keyboard moves.
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(() => Keyboard.metrics()?.height ?? 0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const move = (e: KeyboardEvent, h: number) => {
      if (ios) LayoutAnimation.configureNext(LayoutAnimation.create(e.duration || 250, 'keyboard', 'opacity'));
      setHeight(h);
    };
    const shown = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => move(e, e.endCoordinates.height));
    const hidden = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) => move(e, 0));
    // A keyboard that came up before this listened is caught once it is up.
    const up = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    return () => {
      shown.remove();
      hidden.remove();
      up.remove();
    };
  }, []);
  return height;
}

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    page: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 12 },
    backdrop: { backgroundColor: 'rgba(0,0,0,0.3)' },
    card: {
      width: '100%',
      maxWidth: 400,
      padding: 20,
      gap: 12,
      borderRadius: 28,
      backgroundColor: c.surface,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
    },
    title: { textAlign: 'center', fontSize: fs(17), fontWeight: '600', color: c.text },
    note: { textAlign: 'center', fontSize: fs(13), color: c.muted },
    input: { minHeight: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg, fontSize: Math.max(16, fs(16)), color: c.text },
    actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
    action: { flex: 1 },
  });
