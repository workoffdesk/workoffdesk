import { askOptions, type Ask } from '@workoffdesk/client/model/chat';
import { t } from '@workoffdesk/i18n';
import { ScrollView, Text, View } from 'react-native';
import { Button } from '../ui';
import { useAgentName } from '@workoffdesk/react/agentName';
import { useStyles } from './styles';
import { Option, useAskAnswer } from './common';

export function PermissionCard(props: { sessionId: string; ask: Ask; onScreen: () => void; onDone: () => void }) {
  const s = useStyles();
  const { ask } = props;
  const head = t.allowTool(ask.tool);
  const { busy, note, send } = useAskAnswer(props.sessionId, ask, head, props.onDone);
  const who = useAgentName();
  return (
    <View style={s.card} accessibilityLabel={t.agentAsks(who)}>
      <ScrollView style={s.scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.panelTitle}>{head}</Text>
        {!!ask.title && ask.title !== ask.detail && <Text style={s.context}>{ask.title}</Text>}
        {!!ask.detail && (
          <View style={s.panelBody}>
            <Text style={s.mono} selectable>
              {ask.detail}
            </Text>
          </View>
        )}
        {askOptions(ask).map((o) => (
          <Option key={o.label} label={o.label} detail={o.detail} code={o.code} disabled={busy} onPress={() => send(o.answer, o.label, o.code)} />
        ))}
        {note && <Text style={s.note}>{note}</Text>}
      </ScrollView>
      <View style={s.actions}>
        <Button small label={t.showScreen} onPress={props.onScreen} />
      </View>
    </View>
  );
}
