import type { Composer } from '@workoffdesk/client/composer/composer';
import type { Zone } from '@workoffdesk/client/composer/talk';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AppState, TextInput, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import type { Source } from './sending';

// How far below the targets' round edge the finger is taken as slid up to them.
export const REACH_PX = 40;
// Pictures picked from the library at once.

export type Circle = { x: number; y: number; r: number };

export type Frame = { x: number; y: number };

// Holding the empty box to talk: where the finger is slid to among the targets, and the listening ended
// with the screen.
export function useVoice(composer: Composer<Source>, field: RefObject<TextInput | null>) {
  // Where the composer is on the window, which the voice panel is laid out from.
  const [at, setAt] = useState<Frame>({ x: 0, y: 0 });
  const wrap = useRef<View>(null);
  const targets = useRef<Partial<Record<Zone, Circle>>>({});
  // Slid up as far as the targets, the finger picks the one on its side; below them it sends.
  const zoneAt = (e: GestureResponderEvent): Zone => {
    const { pageX, pageY } = e.nativeEvent;
    const placed = Object.entries(targets.current) as [Zone, Circle][];
    if (!placed.length || pageY > Math.max(...placed.map(([, at]) => at.y + at.r + REACH_PX))) return 'send';
    return placed.reduce((a, b) => (Math.abs(pageX - b[1].x) < Math.abs(pageX - a[1].x) ? b : a))[0];
  };
  const onPressIn = () => {
    wrap.current?.measureInWindow((x, y) => setAt({ x, y }));
    composer.pressIn();
  };
  const onMove = (e: GestureResponderEvent) => composer.move(zoneAt(e));
  // A tap types.
  const onLetGo = (e: GestureResponderEvent | null) => {
    if (composer.letGo(e ? zoneAt(e) : null) === 'tap') field.current?.focus();
  };
  // Listening ends with the screen: leaving it, or the app going to the background. The composer going
  // away (the session ending) is its leave().
  useFocusEffect(useCallback(() => () => composer.dropTalk(), [composer]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => state === 'background' && composer.dropTalk());
    return () => sub.remove();
  }, [composer]);
  const measure = (zone: Zone) => (e: LayoutChangeEvent) =>
    e.currentTarget.measureInWindow((x, y, w, h) => (targets.current[zone] = { x: x + w / 2, y: y + h / 2, r: w / 2 }));
  return { at, wrap, onPressIn, onMove, onLetGo, measure };
}
