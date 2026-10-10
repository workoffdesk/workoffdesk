import { pickerHead } from '@workoffdesk/client/model/chat';
import { t } from '@workoffdesk/i18n';
import { useContext } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { InPopup } from '../Popup';
import type { CardProps } from '@workoffdesk/react/answers';
import { CURRENT_MARK, DialogHead, useAnswer } from './common';
import { useStyles } from './styles';
import { AskCard } from './AskCard';

export function ChoiceCard(props: CardProps) {
  const popped = useContext(InPopup);
  return popped && props.choices.opened ? <Picker {...props} /> : <AskCard {...props} />;
}

// A picker of Claude Code's (/model, /config) in a Popup, drawn as the app's own menus are: a title, a line
// on what it is for, and its options, the one it is at now ticked.
function Picker(props: CardProps) {
  const s = useStyles();
  const { busy, note, send } = useAnswer(props.sessionId, props.onDone, props.choices.context);
  const { options, context } = props.choices;
  const head = pickerHead(context);
  return (
    <View style={s.bare} accessibilityLabel={head.title}>
      <DialogHead title={head.title} about={head.about} />
      <ScrollView style={s.scroll} contentContainerStyle={s.pills} keyboardShouldPersistTaps="handled">
        {options.map((o, i) => {
          const current = CURRENT_MARK.test(o.label);
          const label = o.typed ? t.writeOwnAnswer : o.label.replace(CURRENT_MARK, '');
          return (
            <Pressable
              key={`${i}-${o.label}`}
              accessibilityRole="menuitem"
              accessibilityState={{ checked: current, disabled: busy }}
              disabled={busy}
              onPress={() => send({ index: i, label: o.label }, o.typed ? null : label)}
              style={({ pressed }) => [s.pill, current && s.pillCurrent, pressed && s.pillPressed, busy && s.disabled]}
            >
              <View style={s.optText}>
                <Text style={[s.pillLabel, current && s.pillLabelCurrent]}>{label}</Text>
                {!!o.detail && <Text style={s.pillDetail}>{o.detail}</Text>}
              </View>
              {current && <Text style={s.check}>✓</Text>}
            </Pressable>
          );
        })}
        {note && <Text style={s.note}>{note}</Text>}
      </ScrollView>
    </View>
  );
}
