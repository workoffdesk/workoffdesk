import { t } from '@workoffdesk/i18n';
import { SymbolView } from 'expo-symbols';
import { createContext, useMemo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type Theme } from '../theme';

// Whether what is drawn sits in a Popup, which is its card and its close: it then draws neither.
export const InPopup = createContext(false);

// A card in the middle of the screen over the dimmed page, as iOS puts its own choices (the photo picker's),
// with a round close under it; it closes too on a tap on the dimmed page. While `busy`, what was picked is on
// its way: it spins and takes no press.
export function Popup({ children, onClose, busy }: { children: ReactNode; onClose: () => void; busy?: boolean }) {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const insets = useSafeAreaInsets();
  return (
    <View style={[StyleSheet.absoluteFill, s.center, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal>
      <Pressable style={[StyleSheet.absoluteFill, s.backdrop]} accessible={false} onPress={busy ? undefined : onClose} />
      <View style={s.card}>
        <InPopup value>{children}</InPopup>
        {busy && (
          <View style={[StyleSheet.absoluteFill, s.busy]} accessibilityLabel={t.applying} accessibilityState={{ busy: true }}>
            <ActivityIndicator size="large" color={theme.c.text} />
          </View>
        )}
      </View>
      <Pressable
        style={({ pressed }) => [s.close, pressed && s.closePressed, busy && s.closeBusy]}
        accessibilityRole="button"
        accessibilityLabel={t.close}
        disabled={busy}
        hitSlop={8}
        onPress={onClose}
      >
        <SymbolView name="xmark" tintColor={theme.c.text} size={18} weight="semibold" />
      </Pressable>
    </View>
  );
}

const styles = ({ c }: Theme) =>
  StyleSheet.create({
    center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    backdrop: { backgroundColor: 'rgba(0,0,0,0.3)' },
    card: {
      width: '100%',
      maxWidth: 400,
      flexShrink: 1,
      padding: 14,
      borderRadius: 32,
      backgroundColor: c.surface,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
    },
    busy: { alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface + 'cc' },
    close: {
      marginTop: 16,
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surface,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    closePressed: { backgroundColor: c.surface2 },
    closeBusy: { opacity: 0.4 },
  });
