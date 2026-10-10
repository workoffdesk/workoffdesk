import { t } from '@workoffdesk/i18n';
import { useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTheme, type Theme } from '../theme';

// The shape of a conversation, Claude's lines on the left and a bubble of mine on the right, newest at
// the bottom, as the chat will lay it out.
const SHAPE: ({ mine: true; width: `${number}%`; height: number } | { mine: false; lines: `${number}%`[] })[] = [
  { mine: false, lines: ['92%', '78%', '54%'] },
  { mine: true, width: '58%', height: 40 },
  { mine: false, lines: ['88%', '96%', '70%', '36%'] },
  { mine: true, width: '42%', height: 40 },
  { mine: false, lines: ['84%', '62%'] },
];
const PULSE_MS = 800;
const LOW = 0.5;

// How bright a placeholder is, from LOW to full and back.
function usePulse() {
  const [glow] = useState(() => new Animated.Value(LOW));
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(glow, { toValue: LOW, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [glow]);
  return glow;
}

// Where the chat will be while it is read for the first time.
export function ChatSkeleton() {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const glow = usePulse();
  return (
    <Animated.View style={[s.wrap, { opacity: glow }]} accessible accessibilityLabel={t.reading} pointerEvents="none">
      {SHAPE.map((row, i) =>
        row.mine ? (
          <View key={i} style={[s.bubble, { width: row.width, height: row.height }]} />
        ) : (
          <View key={i} style={s.reply}>
            {row.lines.map((w, j) => (
              <View key={j} style={[s.line, { width: w }]} />
            ))}
          </View>
        ),
      )}
    </Animated.View>
  );
}

// Where the pill under the composer will be until the session says what runs in it.
export function PillSkeleton() {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const glow = usePulse();
  return (
    <View style={s.pillFoot}>
      <Animated.View style={[s.pill, { opacity: glow }]} accessible accessibilityLabel={t.reading} pointerEvents="none" />
    </View>
  );
}

const styles = (c: Theme['c']) =>
  StyleSheet.create({
    wrap: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', gap: 18, paddingHorizontal: 16, paddingBottom: 16 },
    reply: { gap: 9 },
    line: { height: 12, borderRadius: 6, backgroundColor: c.border },
    bubble: { alignSelf: 'flex-end', borderRadius: 16, borderBottomRightRadius: 6, backgroundColor: c.border },
    // As the pill's own foot and pill in SessionPill.tsx, so the composer keeps its height when the pill comes.
    pillFoot: { flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 2 },
    pill: { width: 200, height: 32, borderRadius: 16, backgroundColor: c.surface2 },
  });
