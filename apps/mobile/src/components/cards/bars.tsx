import { panelName, type Panel } from '@workoffdesk/client/model/chat';
import { quitOnMac } from '@workoffdesk/client/sessions/quitOnMac';
import { duration } from '@workoffdesk/client/model/format';
import { t } from '@workoffdesk/i18n';
import { useEffect, useState } from 'react';
import { Alert, Animated, Text, View } from 'react-native';
import { api } from '../../client';
import { Button } from '../ui';
import { useAgentName } from '@workoffdesk/react/agentName';
import { useNow } from '@workoffdesk/react/clock';
import { useStyles } from './styles';
import { useTheme } from '../../theme';
import { SymbolView } from 'expo-symbols';

export function WaitingBar({ onScreen }: { onScreen: () => void }) {
  const s = useStyles();
  const who = useAgentName();
  return (
    <View style={s.waiting} accessibilityRole="summary">
      <Text style={s.waitingText}>{t.agentWaiting(who)}</Text>
      <Button small label={t.showScreen} onPress={onScreen} />
    </View>
  );
}

// Above the composer while a panel holds back what is sent. `nudge` changes each time a send is held, and
// the bar shakes to draw the eye back to it. Its close is Esc.
export function SendHeld(props: { panel: Panel; nudge: number; onKey: (data: string) => boolean; onDone: () => void }) {
  const s = useStyles();
  const [shift] = useState(() => new Animated.Value(0));
  const who = useAgentName();
  useEffect(() => {
    if (!props.nudge) return;
    const step = (toValue: number, duration: number) => Animated.timing(shift, { toValue, duration, useNativeDriver: true });
    const shake = Animated.sequence([step(-6, 100), step(6, 200), step(0, 100)]);
    shake.start();
    return () => shake.stop();
  }, [props.nudge, shift]);
  return (
    <Animated.View style={[s.held, { transform: [{ translateX: shift }] }]} accessibilityLabel={t.sendPaused} accessibilityLiveRegion="polite">
      <View style={s.heldText}>
        <Text style={s.heldTitle}>{t.agentHasOpen(who, panelName(props.panel))}</Text>
        <Text style={s.heldSub}>{t.heldWhilePanel}</Text>
      </View>
      <Button small label={t.close} onPress={() => props.onKey('\x1b') && props.onDone()} />
    </Animated.View>
  );
}

// Above the composer while Claude compacts its conversation, with how long it has been at it.
export function CompactingBar({ count, since }: { count: number; since: number | null }) {
  const s = useStyles();
  const now = useNow(since !== null);
  return (
    <View style={s.held} accessibilityLabel={t.compactingContext}>
      <View style={s.heldText}>
        <Text style={s.heldTitle}>
          {t.compactingContext}
          {since !== null && ` · ${duration(Math.max(0, now - since))}`}
        </Text>
        <Text style={s.heldSub}>{count ? t.compactingQueued(count) : t.compactingWillQueue}</Text>
      </View>
    </View>
  );
}

// Above the composer while Claude runs a tool in the foreground that Claude Code offers to send to the
// background: what is sent waits for the tool, unless it goes there. call: that tool's, when known.
export function ForegroundBar({ call, busy, onBackground }: { call: string | null; busy: boolean; onBackground: () => void }) {
  const s = useStyles();
  const who = useAgentName();
  return (
    <View style={s.held} accessibilityLabel={t.foregroundRuns(who)}>
      <View style={s.heldText}>
        <Text style={s.heldTitle}>{t.foregroundRuns(who)}</Text>
        {call && (
          <Text style={s.heldCode} numberOfLines={1}>
            {call}
          </Text>
        )}
        <Text style={s.heldSub}>{t.foregroundSub}</Text>
      </View>
      <Button small label={t.runInBackground} busy={busy} onPress={onBackground} />
    </View>
  );
}

// Above the composer while the conversation is open in a terminal on the Mac too, in a Claude of its own, which it
// quits; one there at work only once told to. The bar goes once the Mac no longer has it open.
export function OnMacBar({ terminals, sessionId }: { terminals: number; sessionId: string }) {
  const s = useStyles();
  const { c } = useTheme();
  const [quitting, setQuitting] = useState(false);
  const confirm = () =>
    new Promise<boolean>((done) =>
      Alert.alert(
        t.alsoOnMac(terminals),
        t.quitOnMacBusy,
        [
          { text: t.cancel, style: 'cancel', onPress: () => done(false) },
          { text: t.quitAnyway, style: 'destructive', onPress: () => done(true) },
        ],
        { cancelable: true, onDismiss: () => done(false) },
      ),
    );
  const quit = () => {
    setQuitting(true);
    void quitOnMac(api, sessionId, confirm).then((why) => {
      setQuitting(false);
      if (why) Alert.alert(t.failed, why);
    });
  };
  return (
    <View style={s.onMac} accessibilityLabel={t.alsoOnMac(terminals)}>
      <View style={s.onMacTitle}>
        <SymbolView name="desktopcomputer" tintColor={c.waiting} size={16} />
        <Text style={s.heldTitle}>{t.alsoOnMac(terminals)}</Text>
      </View>
      <View style={s.onMacRow}>
        <Text style={s.onMacSub}>{t.alsoOnMacSub}</Text>
        <Button small label={t.quitOnMac} busy={quitting} onPress={quit} />
      </View>
    </View>
  );
}
