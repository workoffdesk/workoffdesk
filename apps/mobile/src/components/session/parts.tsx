import type { Background } from '@workoffdesk/client/journal/journalRows';
import { t } from '@workoffdesk/i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../ui';
import { S } from './styles';

// The commands Claude runs in the background; Claude Code's own /tasks dialog stops them.
export function BackgroundBar({ running, onManage, s }: { running: Background[]; onManage: () => void; s: S }) {
  const [open, setOpen] = useState(false);
  if (!running.length) return null;
  return (
    <View style={s.bg}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={s.bgHead}>
          <Text style={s.bold}>{t.runningInBackground}</Text> {t.backgroundRunning(running.length)}
        </Text>
      </Pressable>
      {open && (
        <>
          {running.map((b) => (
            <Text key={b.id} style={s.bgItem} numberOfLines={1}>
              {b.label} <Text style={s.muted}>#{b.id}</Text>
            </Text>
          ))}
          <Button small label={t.backgroundOpen} onPress={onManage} />
        </>
      )}
    </View>
  );
}

export function Overlay({ title, sub, children, s }: { title: string; sub: string; children?: ReactNode; s: S }) {
  return (
    <View style={s.overlay}>
      <View style={s.overlayCard}>
        <Text style={s.overlayTitle}>{title}</Text>
        <Text style={[s.muted, s.center]}>{sub}</Text>
        {children}
      </View>
    </View>
  );
}

// Three dots rising one after another, like a reply on its way.
export function SyncDots() {
  const [phase] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(phase, { toValue: 1, duration: DOTS_MS, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [phase]);
  return (
    <View style={dotStyles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((i) => {
        // Each rises a sixth of a beat after the one before; all three rest for the end of the beat.
        const at = Animated.modulo(Animated.add(phase, 1 - i / 6), 1);
        const translateY = at.interpolate({ inputRange: [0, 0.18, 0.36, 1], outputRange: [0, -5, 0, 0] });
        const opacity = at.interpolate({ inputRange: [0, 0.18, 0.36, 1], outputRange: [0.45, 1, 0.45, 0.45] });
        return <Animated.View key={i} style={[dotStyles.dot, { opacity, transform: [{ translateY }] }]} />;
      })}
    </View>
  );
}

const DOTS_MS = 1100;

const dotStyles = StyleSheet.create({
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
});
