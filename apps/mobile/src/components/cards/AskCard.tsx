import { t } from '@workoffdesk/i18n';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button } from '../ui';
import { Markdown } from '../Markdown';
import { useAgentName } from '@workoffdesk/react/agentName';
import type { CardProps } from '@workoffdesk/react/answers';
import { useStyles } from './styles';
import { CardActions, Option, useAnswer, useFrame } from './common';

// What Claude asks in the chat, one option to take: a tap picks it and Submit sends it, so a tap that missed
// is not an answer. Writing an answer of one's own is not one yet, so it goes on a tap.
export function AskCard(props: CardProps) {
  const s = useStyles();
  const frame = useFrame();
  const { busy, note, send } = useAnswer(props.sessionId, props.onDone, props.choices.context);
  const { choices } = props;
  const who = useAgentName();
  const [picked, setPicked] = useState<{ index: number; label: string } | null>(null);
  // An option picked before the options changed is not picked any more.
  const chosen = picked && choices.options[picked.index]?.label === picked.label ? picked : null;
  return (
    <View style={frame} accessibilityLabel={t.agentAsks(who)}>
      <ScrollView style={s.scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {choices.plan && (
          <View style={s.plan}>
            <Text style={s.planHead}>{t.plan}</Text>
            <Markdown text={choices.plan} />
          </View>
        )}
        {!!choices.context && <Text style={s.context}>{choices.context}</Text>}
        {choices.options.map((o, i) => (
          <Option
            key={`${i}-${o.label}`}
            label={o.typed ? t.writeOwnAnswer : o.label}
            detail={o.detail}
            picked={o.typed ? null : chosen?.index === i}
            disabled={busy}
            onPress={() => (o.typed ? send({ index: i, label: o.label }, null) : setPicked({ index: i, label: o.label }))}
          />
        ))}
        {choices.options[choices.cursor]?.typed && <Text style={s.note}>{t.writeBelow}</Text>}
        {note && <Text style={s.note}>{note}</Text>}
        <Button kind="primary" label={t.submit} disabled={!chosen} busy={busy} onPress={() => chosen && send(chosen, chosen.label)} />
      </ScrollView>
      <CardActions {...props} busy={busy} />
    </View>
  );
}
