import { ACTION_PX, gestureOf, rowShift, staysOpen } from '@workoffdesk/client/sessions/rowSwipe';
import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../theme';
import type { RowAction } from './rows';

// A row that slides left under the finger to show its actions behind it, as the web's does, and settles open or
// shut where it is let go. The list keeps the id of the one open, so opening a row shuts the others.
export function SwipeRow({ id, open, setOpen, actions, theme, children }: { id: string; open: boolean; setOpen: Dispatch<SetStateAction<string | null>>; actions: RowAction[]; theme: Theme; children: ReactNode }) {
  const { c } = theme;
  const st = useMemo(() => styles(theme), [theme]);
  const width = actions.length * ACTION_PX;
  const [x] = useState(() => new Animated.Value(0));
  useEffect(() => Animated.timing(x, { toValue: open ? -width : 0, duration: 200, useNativeDriver: true }).start(), [x, open, width]);
  // Made again only when the row opens or shuts, which is between gestures.
  const pan = useMemo(() => {
    const letGo = (dx: number) => {
      const to = staysOpen(open, rowShift(open, width, dx), width);
      Animated.timing(x, { toValue: to ? -width : 0, duration: 200, useNativeDriver: true }).start();
      setOpen((now) => (to ? id : now === id ? null : now));
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => gestureOf(g.dx, g.dy) === 'swipe',
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => x.stopAnimation(),
      onPanResponderMove: (_, g) => x.setValue(rowShift(open, width, g.dx)),
      onPanResponderRelease: (_, g) => letGo(g.dx),
      onPanResponderTerminate: (_, g) => letGo(g.dx),
    });
  }, [x, open, width, id, setOpen]);
  return (
    <View style={st.swipe}>
      <View style={[st.actions, { width }]}>
        {actions.map((a) => (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            style={[st.action, { backgroundColor: a.destructive ? c.danger : c.accent }]}
            onPress={() => {
              setOpen(null);
              a.run();
            }}
          >
            <Text style={[st.actionText, { color: a.destructive ? '#fff' : c.accentText }]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = ({ fs }: Theme) =>
  StyleSheet.create({
    swipe: { overflow: 'hidden' },
    actions: { position: 'absolute', top: 0, right: 0, bottom: 0, flexDirection: 'row' },
    action: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    actionText: { fontSize: fs(15), fontWeight: '600' },
  });
