import { effortName, panelName, type Panel } from '@workoffdesk/client/model/chat';
import { t } from '@workoffdesk/i18n';
import { useContext } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Segments } from '../ui';
import { InPopup } from '../Popup';
import { useAgentName } from '@workoffdesk/react/agentName';
import { effortKeys, scrollsInParts, SCROLL_DOWN, SCROLL_UP } from '@workoffdesk/client/chat/panel';
import { useStyles } from './styles';
import { DialogHead, useFrame } from './common';

// Typing goes into a panel while it is open, so the chat shows it and closes it instead, with Esc. In a
// Popup it is headed as the app's own menus are; in the chat, by what Claude opened.
export function PanelCard(props: { panel: Panel; onKey: (data: string) => boolean; onScreen: () => void; onDone: () => void }) {
  const s = useStyles();
  const frame = useFrame();
  const popped = useContext(InPopup);
  const { usage, effort, btw, body } = props.panel;
  const who = useAgentName();
  const name = btw ? t.btwAsked : t.agentOpened(who, panelName(props.panel));
  const title = btw ? t.panelTitles.Btw : props.panel.title ? (t.panelTitles[props.panel.title] ?? props.panel.title.replace(/\s+/g, ' ')) : name;
  const press = (keys: string) => props.onKey(keys) && props.onDone();
  const setEffort = (to: number) => effort && press(effortKeys(effort, to));
  const scrolls = scrollsInParts(props.panel);
  return (
    <View style={popped ? frame : [frame, s.panel]} accessibilityLabel={popped ? title : name}>
      {popped && <DialogHead title={title} about={effort ? t.effortHint : btw?.question} />}
      <ScrollView style={s.scroll} contentContainerStyle={popped ? s.poppedBody : s.body} keyboardShouldPersistTaps="handled">
        {!popped && <Text style={s.panelTitle}>{name}</Text>}
        {usage && (
          <View style={popped ? s.usageLines : s.usages}>
            <Text style={popped ? s.usageLine : s.usage}>{usage.session === null ? t.fiveHourUnseen : t.fiveHourUsed(usage.session)}</Text>
            <Text style={popped ? s.usageLine : s.usage}>{usage.week === null ? t.weekUnseen : t.weekUsed(usage.week)}</Text>
          </View>
        )}
        {effort ? (
          <Segments
            options={effort.levels.map((level) => ({ value: level, label: effortName(level) }))}
            value={effort.levels[effort.at] ?? null}
            onPick={(level) => setEffort(effort.levels.indexOf(level))}
          />
        ) : btw ? (
          <>
            {!popped && (
              <Text style={s.question} selectable>
                {btw.question}
              </Text>
            )}
            {!!body && (
              <Text style={s.answer} selectable>
                {body}
              </Text>
            )}
          </>
        ) : (
          // In a Popup, /usage is its two figures; the rest of its screen is a tap on 看屏幕 away.
          !!body &&
          !(popped && usage) && (
            <View style={s.panelBody}>
              <Text style={s.mono} selectable>
                {body}
              </Text>
            </View>
          )
        )}
        {effort && !popped && <Text style={s.note}>{t.effortHint}</Text>}
      </ScrollView>
      <View style={popped ? s.poppedActions : s.actions}>
        {scrolls && <Button small label={t.scrollUp} onPress={() => press(SCROLL_UP)} />}
        {scrolls && <Button small label={t.scrollDown} onPress={() => press(SCROLL_DOWN)} />}
        {!popped && <Button small label={t.closeEsc} onPress={() => press('\x1b')} />}
        <Button small label={t.showScreen} onPress={props.onScreen} />
      </View>
    </View>
  );
}
