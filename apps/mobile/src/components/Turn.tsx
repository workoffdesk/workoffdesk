import { noteText, type ToolTurn, type Turn } from '@workoffdesk/client/model/chat';
import { clock, duration } from '@workoffdesk/client/model/format';
import { t } from '@workoffdesk/i18n';
import { memo, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { type S, useStyles } from './turn/styles';
import { useOpened } from './turn/common';
import { ChangesCard, DiffCount, Tool, ToolSummary } from './turn/tools';
import { Mine, Reply } from './turn/bubbles';

function Note({ turn, onRetry, retryActions, s }: { turn: Extract<Turn, { k: 'note' }>; onRetry?: () => void; retryActions?: ReactNode; s: S }) {
  const [open, setOpen] = useState(false);
  if (turn.retry)
    return (
      <View style={[s.stopped, turn.detail ? s.stoppedFailed : null]} accessibilityRole="summary">
        <Text style={[s.stoppedText, turn.detail ? s.danger : null]}>
          {turn.detail ? '⊗' : '×'} {noteText(turn)}
          {!!turn.detail && <Text style={s.muted}> · {turn.detail}</Text>}
        </Text>
        {onRetry && (
          <Pressable style={s.smallBtn} onPress={onRetry} accessibilityRole="button">
            <Text style={s.smallBtnText}>{t.tryAgain}</Text>
          </Pressable>
        )}
        {onRetry && retryActions}
      </View>
    );
  if (!turn.detail) return <Text style={s.note}>{noteText(turn)}</Text>;
  return (
    <View style={s.center}>
      <Text style={s.note} onPress={() => setOpen(!open)} accessibilityRole="button">
        {noteText(turn)} {open ? '⌄' : '›'}
      </Text>
      {open && <Text style={s.noteDetail}>{turn.detail}</Text>}
    </View>
  );
}

// A turn as the chat draws it. A turn of the user's that left workoffdesk's queue reads as sent until Claude
// answers it. last: the turn ends a reply, which gets the reply's actions. onRewind: offered under the last
// message sent; onRetry: on the last stopped note, to say "continue"; retryActions: other ways on, beside it.
export const TurnView = memo(function TurnView(props: {
  sessionId: string;
  t: Turn;
  repeated?: Set<string>;
  sent?: boolean;
  last?: boolean;
  onRewind?: () => void;
  onRetry?: () => void;
  retryActions?: ReactNode;
}) {
  const s = useStyles();
  const { sessionId, t: turn } = props;
  switch (turn.k) {
    case 'user':
      if (!props.sent) return <Mine sessionId={sessionId} text={turn.text} at={turn.at} onRewind={props.onRewind} />;
      return (
        <View style={s.mine} accessibilityLabel={t.sentMessage}>
          <Mine sessionId={sessionId} text={turn.text} />
          <Text style={s.small}>{t.sent}</Text>
        </View>
      );
    case 'text':
      return <Reply sessionId={sessionId} text={turn.text} repeated={props.repeated} last={props.last} />;
    case 'note':
      return <Note turn={turn} onRetry={props.onRetry} retryActions={props.retryActions} s={s} />;
    case 'changes':
      return <ChangesCard files={turn.files} s={s} />;
    case 'tool':
      return <Tool sessionId={sessionId} turn={turn} repeated={props.repeated} s={s} />;
  }
});

// Calls made one after another, as one row: how many, when they ended, how long they took and what
// they changed; still going (going, or a call unanswered), the newest call. It opens to the calls.
export const ToolsRow = memo(function ToolsRow({ sessionId, tools, going, end: endAt }: { sessionId: string; tools: (ToolTurn & { key: string })[]; going: boolean; end?: string }) {
  const s = useStyles();
  const [open, setOpen] = useOpened(tools.map((x) => x.key));
  const live = going || tools.some((x) => !x.result);
  const latest = tools.at(-1)!;
  const start = Date.parse(tools[0].at ?? '');
  const end = endAt ?? latest.at;
  const took = Date.parse(end ?? '') - start;
  const added = tools.reduce((n, x) => n + (x.result?.diff?.added ?? 0), 0);
  const removed = tools.reduce((n, x) => n + (x.result?.diff?.removed ?? 0), 0);
  const failed = tools.filter((x) => x.result?.error).length;
  return (
    <View style={s.tool}>
      <Pressable style={s.toolSummaryRow} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        {live ? (
          <>
            <Text style={[s.toolName, { color: s.running.color }]}>{t.toolsCalled(tools.length)}</Text>
            <Text style={s.toolName}>{latest.name}</Text>
            <ToolSummary name={latest.name} summary={latest.summary} s={s} />
          </>
        ) : (
          <>
            <Text style={s.toolName}>{t.toolsDone(tools.length)}</Text>
            <Text style={s.toolSummary} numberOfLines={1}>
              {[clock(end), took >= 1000 ? t.took(duration(took)) : '', failed ? t.toolErrors(failed) : '']
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {(added > 0 || removed > 0) && <DiffCount d={{ added, removed }} s={s} />}
          </>
        )}
        <Text style={s.toolMark}>{open ? '⌄' : '›'}</Text>
      </Pressable>
      {open && (
        <View style={s.toolsList}>
          {tools.map((x) => (
            <TurnView key={x.key} sessionId={sessionId} t={x} />
          ))}
        </View>
      )}
    </View>
  );
});
