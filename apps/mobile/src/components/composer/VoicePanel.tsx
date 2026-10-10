import type { Hold, Zone } from '@workoffdesk/client/composer/talk';
import { t } from '@workoffdesk/i18n';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Animated, Easing, ScrollView, StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tint, useTheme } from '../../theme';
import { type Frame } from './voice';
import { FADE_PX, type S, TARGETS_BOTTOM, TARGETS_TOP } from './styles';

const WAVE_BARS = 54;

const HINTS: Record<Zone, string> = { send: t.holdSendSlide, cancel: t.holdCancel, text: t.holdText };

// Over the bottom of the screen while the box is held, as the web draws it: the page fades into a blue
// glow rising from the bottom, with the two targets and the hint on it and what is heard just above them,
// on the glow, marked as speech. The glow grows to hold it as tall as it is, fading in just above it.
export function VoicePanel({ hold, at, measure, s }: { hold: Hold; at: Frame; measure: (zone: Zone) => (e: LayoutChangeEvent) => void; s: S }) {
  const { c, fs } = useTheme();
  const window = useWindowDimensions();
  const bottom = useSafeAreaInsets().bottom;
  const heardAt = bottom + TARGETS_TOP + 16;
  const [heardTall, setHeardTall] = useState(0);
  const veil = Math.max(window.height * 0.38, 340, hold.heard ? TARGETS_TOP + 16 + heardTall + FADE_PX : 0) + bottom;
  // The fade is as tall wherever the glow's top is; below it the blue deepens to the bottom.
  const fade = (FADE_PX / veil) * 100;
  const stop = (share: number) => `${(fade + (100 - fade) * share).toFixed(1)}%`;
  const glow = `linear-gradient(to bottom, ${tint(c.surface, 0)} 0%, ${c.glow[0]} ${fade.toFixed(1)}%, ${c.glow[1]} ${stop(0.3)}, ${c.glow[2]} ${stop(0.55)}, ${c.glow[3]} 100%)`;
  const deepest = c.glow[3];
  const heard = useRef<ScrollView>(null);
  const target = (zone: Zone, label: string, icon: ComponentProps<typeof SymbolView>['name']) => {
    const active = hold.zone === zone;
    return (
      <View style={[s.target, active && s.targetActive]}>
        <View onLayout={measure(zone)} style={[s.targetDot, active && s.targetDotActive]}>
          <SymbolView name={icon} tintColor={active ? (zone === 'cancel' ? c.danger : deepest) : '#fff'} size={26} weight="semibold" />
        </View>
        <Text style={[s.targetLabel, active && s.white]}>{label}</Text>
      </View>
    );
  };
  return (
    <View
      style={[s.panel, { left: -at.x, width: window.width, top: window.height - veil - at.y, height: veil, experimental_backgroundImage: glow }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
    >
      {!!hold.heard && (
        <View style={[s.heard, { bottom: heardAt }]} onLayout={(e) => setHeardTall(e.nativeEvent.layout.height)}>
          <View style={s.heardLabel}>
            <SymbolView name="mic.fill" tintColor={deepest} size={fs(13)} />
            <Text style={s.heardLabelText}>{t.heardLabel}</Text>
          </View>
          <ScrollView ref={heard} style={s.heardScroll} onContentSizeChange={() => heard.current?.scrollToEnd({ animated: false })}>
            <Text style={s.heardText}>{hold.heard}</Text>
          </ScrollView>
        </View>
      )}
      {!hold.finishing && (
        <View style={[s.targets, { bottom: bottom + TARGETS_BOTTOM }]}>
          {target('cancel', t.cancel, 'xmark')}
          {target('text', t.toText, 'character.cursor.ibeam')}
        </View>
      )}
      <Text style={[s.hint, { bottom: bottom + 120 }, hold.zone !== 'send' && s.hintStrong]}>
        {hold.finishing ? t.recognizing : HINTS[hold.zone]}
      </Text>
      <View style={[s.waveAt, { bottom: bottom + 62 }]}>
        {hold.listening ? <Wave /> : <ActivityIndicator color="#fff" accessibilityLabel={t.openingMic} />}
      </View>
    </View>
  );
}

// Bars rising and falling out of step, faded at both ends.
function Wave() {
  const [phase] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(phase, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [phase]);
  return (
    <View style={waveStyles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: WAVE_BARS }, (_, i) => {
        const offset = ((i * 137) % 900) / 900;
        const edge = Math.min(i, WAVE_BARS - 1 - i) / (WAVE_BARS * 0.18);
        const scaleY = Animated.modulo(Animated.add(phase, offset), 1).interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 1, 0.3] });
        return <Animated.View key={i} style={[waveStyles.bar, { opacity: Math.min(1, edge), transform: [{ scaleY }] }]} />;
      })}
    </View>
  );
}

const waveStyles = StyleSheet.create({
  wave: { flexDirection: 'row', alignItems: 'center', gap: 2.5, height: 24 },
  bar: { width: 2.5, height: 24, borderRadius: 2, backgroundColor: '#fff' },
});
