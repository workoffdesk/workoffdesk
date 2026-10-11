import { t } from '@workoffdesk/i18n';
import { router, type NativeStackHeaderItem, type NativeStackNavigationOptions } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

export type HeaderItem = NativeStackHeaderItem;

// Header items as the iOS bar's own buttons, without the glass plate iOS 26 sets them on. Both sides are always
// set, empty for none: a screen's options are merged into the ones it had, so a side left out would keep the
// items an earlier render put there.
export function bareHeader({ left, right }: { left: HeaderItem | null; right: HeaderItem | HeaderItem[] | null }): NativeStackNavigationOptions {
  const bare = (items: HeaderItem | HeaderItem[] | null) => () =>
    [items ?? []].flat().map((item): HeaderItem => (item.type === 'spacing' ? item : { hidesSharedBackground: true, ...item }));
  return { unstable_headerLeftItems: bare(left), unstable_headerRightItems: bare(right) };
}

export const backItem = (onPress: () => void = () => router.back()): HeaderItem => ({
  type: 'button',
  label: t.back,
  icon: { type: 'sfSymbol', name: 'chevron.left' },
  onPress,
});

// A sheet's close: the round ✕ iOS gives its own sheets, its glass kept.
export const closeItem = (onPress: () => void = () => router.back()): HeaderItem => ({
  type: 'button',
  label: t.close,
  icon: { type: 'sfSymbol', name: 'xmark' },
  hidesSharedBackground: false,
  onPress,
});

// The header of a pushed screen, drawn in the screen itself so all of it goes with the screen when it is swiped
// back; items in the iOS bar stay where they are until the swipe is over.
export function PageHeader({ title, right }: { title: ReactNode; right?: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.bar, { paddingTop: insets.top, backgroundColor: c.surface, borderBottomColor: c.border }]}>
      <Pressable style={s.side} accessibilityRole="button" accessibilityLabel={t.back} hitSlop={10} onPress={() => router.back()}>
        <SymbolView name="chevron.left" tintColor={c.text} size={24} />
      </Pressable>
      <View style={s.title}>{title}</View>
      <View style={[s.side, s.right]}>{right}</View>
    </View>
  );
}

const s = StyleSheet.create({
  // The bar's height and its items' place, as the list's own bar has them.
  bar: { flexDirection: 'row', alignItems: 'center', paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  side: { minWidth: 56, height: 44, justifyContent: 'center', paddingHorizontal: 24 },
  right: { alignItems: 'flex-end', paddingRight: 26 },
  title: { flex: 1, alignItems: 'center' },
});
