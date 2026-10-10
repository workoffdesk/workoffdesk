import { t } from '@workoffdesk/i18n';
import { ScrollView, Text, View } from 'react-native';
import { Button } from '../ui';
import { useAgentName } from '@workoffdesk/react/agentName';
import type { CardProps } from '@workoffdesk/react/answers';
import { useStyles } from './styles';
import { CardActions, Option, useFrame, useTicks } from './common';

// A question that takes several answers: ticks stay in the card until it is sent, all at once.
export function TickCard(props: CardProps) {
  const s = useStyles();
  const frame = useFrame();
  const { busy, note, ticked, flip, sendTicks } = useTicks(props);
  const { options, submit } = props.choices;
  const who = useAgentName();
  return (
    <View style={frame} accessibilityLabel={t.agentAsks(who)}>
      <ScrollView style={s.scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {!!props.choices.context && <Text style={s.context}>{props.choices.context}</Text>}
        {options.map((o, i) =>
          o.typed ? null : (
            <Option key={`${i}-${o.label}`} label={o.label} detail={o.detail} tick={ticked.has(i)} disabled={busy} onPress={() => flip(i)} />
          ),
        )}
        {options.some((o) => o.typed) && <Text style={s.note}>{t.typedHint}</Text>}
        {note && <Text style={s.note}>{note}</Text>}
        <Button kind="primary" label={`${submit === 'Next' ? t.nextQuestion : t.submit} ${t.ticked(ticked.size)}`} disabled={busy} onPress={sendTicks} />
      </ScrollView>
      <CardActions {...props} busy={busy} />
    </View>
  );
}
