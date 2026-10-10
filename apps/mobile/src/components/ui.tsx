import { isAgent, type TermSession } from '@workoffdesk/client/base/api';
import { statusLabel } from '@workoffdesk/client/model/format';
import { t } from '@workoffdesk/i18n';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { tint, useTheme, type Colors } from '../theme';

const chipColor = (c: Colors, status: TermSession['status']) =>
  status === 'working' ? c.working : status === 'waiting' ? c.waiting : status === 'idle' ? c.idle : null;

export function statusLook(c: Colors, s: Pick<TermSession, 'kind' | 'status'>) {
  const color = isAgent(s.kind) ? chipColor(c, s.status) : null;
  return { color, label: statusLabel(s) };
}

export function StatusChip({ s }: { s: Pick<TermSession, 'kind' | 'status'> }) {
  const { c, fs } = useTheme();
  const { color, label } = statusLook(c, s);
  return (
    <Text
      style={[
        styles.chip,
        { fontSize: fs(12), color: color ?? c.muted, backgroundColor: color ? tint(color, s.status === 'waiting' ? 16 : 14) : c.surface2 },
      ]}
    >
      {label}
    </Text>
  );
}

// The web app's .btn: plain, primary or danger, and small.
export function Button(props: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  kind?: 'plain' | 'primary' | 'danger';
  small?: boolean;
  disabled?: boolean;
  // What it asked for is on its way: it spins and takes no more presses.
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const { c, fs } = useTheme();
  const kind = props.kind ?? 'plain';
  const color = kind === 'primary' ? c.accentText : kind === 'danger' ? c.danger : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: !!props.disabled, busy: !!props.busy }}
      disabled={props.disabled || props.busy}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.btn,
        props.small && styles.small,
        { backgroundColor: kind === 'primary' ? c.accent : c.surface, borderColor: kind === 'primary' ? c.accent : c.border },
        props.disabled && styles.disabled,
        pressed && styles.pressed,
        props.style,
      ]}
    >
      {props.busy && <ActivityIndicator size="small" color={color} />}
      {props.children ?? (
        <Text
          style={{
            fontWeight: '600',
            fontSize: props.small ? fs(14) : fs(16),
            color,
          }}
        >
          {props.label}
        </Text>
      )}
    </Pressable>
  );
}

// The round ✕ at the top right of a sheet, drawn as iOS draws its own sheets' close (closeItem in header.tsx).
export function CloseButton({ onPress }: { onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [styles.close, { backgroundColor: pressed ? c.surface2 : c.surface }]}
      accessibilityRole="button"
      accessibilityLabel={t.close}
      hitSlop={10}
      onPress={onPress}
    >
      <SymbolView name="xmark" tintColor={c.text} size={17} weight="semibold" />
    </Pressable>
  );
}

// One of a few options side by side, the chosen one filled.
export function Segments<T extends string>(props: { options: readonly { value: T; label: string }[]; value: T | null; onPick: (v: T) => void; style?: StyleProp<ViewStyle> }) {
  const { c, fs } = useTheme();
  return (
    <View style={[styles.segments, { backgroundColor: c.surface2 }, props.style]} accessibilityRole="radiogroup">
      {props.options.map((o) => {
        const on = o.value === props.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => props.onPick(o.value)}
            style={({ pressed }) => [styles.segment, on ? { backgroundColor: c.accent } : pressed && { backgroundColor: c.border }]}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
          >
            <Text style={{ fontSize: fs(15), color: on ? c.accentText : c.text, fontWeight: on ? '600' : '400' }} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 25 },
  segment: { flex: 1, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  chip: { fontWeight: '600', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
  btn: { minHeight: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  small: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10 },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.8 },
});
