import { t } from '@workoffdesk/i18n';
import { useContext } from 'react';
import { SymbolView } from 'expo-symbols';
import { Pressable, Text, View } from 'react-native';
import { answers, api } from '../../client';
import { useTheme } from '../../theme';
import { Button } from '../ui';
import { InPopup } from '../Popup';
import { answerHooks, type CardProps } from '@workoffdesk/react/answers';
import { useStyles } from './styles';

// How Claude Code marks the option a picker of its is at now (/model's model).
export const CURRENT_MARK = /\s*✔$/;

export const { useAnswer, useAskAnswer, useTicks } = answerHooks({ api, answers });

// A card's frame: its own in the chat, none in a Popup, which frames it.
export function useFrame() {
  const s = useStyles();
  return useContext(InPopup) ? s.bare : s.card;
}

export function CardActions(props: CardProps & { busy: boolean }) {
  const s = useStyles();
  const popped = useContext(InPopup);
  return (
    <View style={s.actions}>
      {!popped && <Button small label={t.escCancel} disabled={props.busy} onPress={() => props.onKey('\x1b')} />}
      <Button small label={t.showScreen} onPress={props.onScreen} />
    </View>
  );
}

// picked: one of a set only one of which is taken, and this the one; null when the option is not of such a set.
export function Option(props: {
  label: string;
  detail?: string;
  code?: string;
  current?: boolean;
  disabled?: boolean;
  onPress: () => void;
  tick?: boolean | null;
  picked?: boolean | null;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const role = props.tick != null ? 'checkbox' : props.picked != null ? 'radio' : 'button';
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={role === 'button' ? undefined : { checked: !!(props.tick ?? props.picked) }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        s.opt,
        (props.current || props.tick) && s.optCurrent,
        props.picked && s.optPicked,
        pressed && s.optPressed,
        props.disabled && s.disabled,
      ]}
    >
      {props.tick != null && (
        <View style={[s.tick, props.tick && s.ticked]}>
          <Text style={s.tickMark}>{props.tick ? '✓' : ''}</Text>
        </View>
      )}
      <View style={s.optText}>
        <Text style={s.optLabel}>{props.label}</Text>
        {!!props.detail && <Text style={s.optDetail}>{props.detail}</Text>}
        {!!props.code && <Text style={[s.mono, s.optCode]}>{props.code}</Text>}
      </View>
      {props.picked && <SymbolView name="checkmark" tintColor={c.accent} size={18} weight="bold" style={s.pickedMark} />}
    </Pressable>
  );
}

// A dialog's title, and what it is for under it, as the app's own menus head theirs (SessionPill.tsx).
export function DialogHead({ title, about }: { title: string; about?: string }) {
  const s = useStyles();
  return (
    <View style={s.head}>
      <Text style={s.headTitle} accessibilityRole="header">
        {title}
      </Text>
      {!!about && <Text style={s.headAbout}>{about}</Text>}
    </View>
  );
}
