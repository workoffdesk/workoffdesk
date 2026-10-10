import { isLimit, type OnScreen } from '@workoffdesk/client/model/chat';
import type { ChatEntry } from '@workoffdesk/client/chat/chatEntries';
import { duration } from '@workoffdesk/client/model/format';
import { t } from '@workoffdesk/i18n';
import type { ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { WaitingBar } from '../cards/bars';
import { ChoiceCard } from '../cards/ChoiceCard';
import { PanelCard } from '../cards/PanelCard';
import { PermissionCard } from '../cards/PermissionCard';
import { TickCard } from '../cards/TickCard';
import { ToolsRow, TurnView } from '../Turn';
import { SentBubble } from '../turn/bubbles';
import type { Theme } from '../../theme';
import type { S } from './styles';
import { BackgroundBar } from './parts';

export type EntryProps = { id: string; s: S; theme: Theme; who: string; now: number; limitActions?: ReactNode; send: (data: string) => void; press: (data: string) => boolean; reread: () => void; onScreen: () => void };

// One row of the chat, as the phone draws it.
export function entryNode(e: ChatEntry, { id, s, theme, who, now, limitActions, send, press, reread, onScreen }: EntryProps): ReactNode {
  switch (e.kind) {
    case 'tools':
      return <ToolsRow sessionId={id} tools={e.tools} going={e.going} end={e.end} />;
    case 'turn':
      return (
        <TurnView
          sessionId={id}
          t={e.turn}
          repeated={e.repeated}
          sent={e.sent}
          last={e.last}
          onRewind={e.rewind ? () => send('/rewind\r') : undefined}
          onRetry={e.retry ? () => send(`${t.continueWord}\r`) : undefined}
          retryActions={isLimit(e.turn) && limitActions}
        />
      );
    case 'answer':
      return (
        // What it allows from now on goes under it as code, cut short: the card had it whole.
        <View style={s.answeredBox}>
          <Text style={s.answered} numberOfLines={2}>
            {t.youChose}
            {e.answer.said}
          </Text>
          {e.answer.code && (
            <Text style={[s.answered, s.answeredCode]} numberOfLines={2}>
              {e.answer.code}
            </Text>
          )}
        </View>
      );
    case 'empty':
      return (
        <View style={s.empty}>
          <Text style={s.overlayTitle}>{t.noConversation}</Text>
          <Text style={[s.muted, s.center]}>{t.typeBelow}</Text>
        </View>
      );
    case 'live':
      return (
        <View style={s.live}>
          <Text style={s.small}>{t.agentWriting(who)}</Text>
          <Text style={s.liveText}>{e.text}</Text>
        </View>
      );
    case 'bubble':
      return e.message.state === 'sending' ? (
        <View style={s.outbox} accessibilityLabel={t.sendingMessage}>
          <SentBubble sessionId={id} text={e.message.text} held />
          <Text style={s.small}>{t.sending}</Text>
        </View>
      ) : (
        <View style={s.outbox} accessibilityLabel={t.sentMessage}>
          <SentBubble sessionId={id} text={e.message.text} />
          <Text style={s.small}>{t.sent}</Text>
        </View>
      );
    case 'failed':
      return <Text style={s.note}>{t.chatUnreadable}</Text>;
    case 'background':
      return <BackgroundBar running={e.running} onManage={() => send('/tasks\r')} s={s} />;
    case 'working':
      return (
        <View style={s.workingRow}>
          <ActivityIndicator size="small" color={theme.c.muted} />
          <Text style={s.working}>
            {t.claudeWorking}
            {e.since !== null && ` · ${duration(Math.max(0, now - e.since))}`}
          </Text>
        </View>
      );
    case 'ask':
      return <PermissionCard sessionId={id} ask={e.ask} onScreen={onScreen} onDone={reread} />;
    case 'choice':
      return <ChoiceCard sessionId={id} choices={e.choices} onKey={press} onScreen={onScreen} onDone={reread} />;
    case 'tick':
      return <TickCard sessionId={id} choices={e.choices} onKey={press} onScreen={onScreen} onDone={reread} />;
    case 'waiting':
      return <WaitingBar onScreen={onScreen} />;
  }
}

// Claude Code's own dialogs come up over the chat (the Popup below); what Claude asks stays in it.
export const dialogOn = (on: OnScreen, { id, press, onScreen, settle }: { id: string; press: (data: string) => boolean; onScreen: () => void; settle: () => void }) =>
  on.panel ? (
    <PanelCard panel={on.panel} onKey={press} onScreen={onScreen} onDone={settle} />
  ) : on.choices?.opened && !on.choices.submit ? (
    <ChoiceCard sessionId={id} choices={on.choices} onKey={press} onScreen={onScreen} onDone={settle} />
  ) : null;
