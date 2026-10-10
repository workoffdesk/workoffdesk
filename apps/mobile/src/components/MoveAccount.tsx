import { moveOptionLine, type AccountMove, type AccountMoveSnapshot } from '@workoffdesk/client/sessions/moveAccount';
import { t } from '@workoffdesk/i18n';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme, type Theme } from '../theme';
import { Popup } from './Popup';

type Props = { move: AccountMove; state: AccountMoveSnapshot };

// Under a reply an account's limit stopped: going on on another account of the Mac's, the move under way, or,
// with none, how to add one.
export function LimitActions({ move, state }: Props) {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  if (state.waiting)
    return (
      <View style={s.waiting} accessibilityRole="text" accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={theme.c.muted} />
        <Text style={s.how}>{t.movingAccount(state.waiting.email)}</Text>
      </View>
    );
  if (!state.accounts) return null;
  if (!state.accounts.length) return <Text style={[s.how, s.wide]}>{t.moveAccountHow}</Text>;
  return (
    <Pressable style={({ pressed }) => [s.button, pressed && s.pressed]} accessibilityRole="button" onPress={() => move.offer(t.continueWord, false)}>
      <Text style={s.buttonText}>{t.moveAccount}</Text>
    </Pressable>
  );
}

// The accounts to go on on, asked from the limit's note or by a message typed while stopped on it, which goes
// once moved. onGiveBack: the typed message, when not moved.
export function MoveAccountSheet({ move, state, onGiveBack }: Props & { onGiveBack: (text: string) => void }) {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const { asking, accounts, moving, error } = state;
  if (!asking || !accounts) return null;
  const close = () => {
    const typed = move.dismiss();
    if (typed) onGiveBack(typed);
  };
  return (
    <Popup busy={moving !== null} onClose={close}>
      <Text style={s.title}>{t.moveAccountTitle}</Text>
      {!!error && (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {asking.typed && <Text style={s.lead}>{t.moveAccountThen(asking.text)}</Text>}
      <ScrollView style={s.menu} contentContainerStyle={s.items} bounces={false}>
        {accounts.map((a) => (
          <Pressable
            key={a.id}
            style={({ pressed }) => [s.item, pressed && s.itemPressed]}
            accessibilityRole="button"
            accessibilityState={{ busy: moving === a.id, disabled: moving !== null }}
            disabled={moving !== null}
            onPress={() => void move.move(a.id)}
          >
            <View style={s.itemBody}>
              <Text style={s.itemText} numberOfLines={1}>
                {a.email}
              </Text>
              <Text style={s.sub}>{moveOptionLine(a)}</Text>
            </View>
            {moving === a.id && <ActivityIndicator color={theme.c.muted} />}
          </Pressable>
        ))}
      </ScrollView>
      <Text style={s.note}>{t.moveAccountNote}</Text>
    </Popup>
  );
}

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    how: { fontSize: fs(12), color: c.muted, textAlign: 'center' },
    wide: { flexBasis: '100%' },
    waiting: { flexBasis: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    button: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10, backgroundColor: c.accent, justifyContent: 'center' },
    pressed: { opacity: 0.7 },
    buttonText: { fontSize: fs(14), fontWeight: '600', color: c.accentText },
    title: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 12, textAlign: 'center', fontSize: fs(17), fontWeight: '600', color: c.text },
    lead: { paddingHorizontal: 8, paddingBottom: 12, fontSize: fs(15), color: c.text, textAlign: 'center' },
    error: { paddingHorizontal: 8, paddingBottom: 8, fontSize: fs(14), color: c.danger },
    menu: { flexShrink: 1 },
    items: { gap: 8 },
    item: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 25, backgroundColor: c.surface2 },
    itemPressed: { backgroundColor: c.border },
    itemBody: { flex: 1, gap: 2 },
    itemText: { fontSize: fs(15), color: c.text },
    sub: { fontSize: fs(12), color: c.muted },
    note: { paddingHorizontal: 8, paddingTop: 12, fontSize: fs(12), color: c.muted, textAlign: 'center' },
  });
