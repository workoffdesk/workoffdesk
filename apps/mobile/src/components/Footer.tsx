import type { Queued } from '@workoffdesk/client/base/api';
import type { InQueue, Task } from '@workoffdesk/client/journal/journalRows';
import { ENTER, KEYS } from '@workoffdesk/client/composer/keys';
import { mineInBrief } from '@workoffdesk/client/chat/images';
import { t } from '@workoffdesk/i18n';
import { useMemo, useRef, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAgentName } from '@workoffdesk/react/agentName';
import { useScreenText, type Keys } from '@workoffdesk/react/screenText';
import { api } from '../client';
import { MONO, useTheme, type Theme } from '../theme';
import { Button, CloseButton } from './ui';

function useStyles() {
  const theme = useTheme();
  return useMemo(() => styles(theme), [theme]);
}

export function KeyBar(props: Keys) {
  const s = useStyles();
  return (
    <View style={s.keybar} accessibilityLabel={t.keys}>
      {KEYS.map((k) =>
        k.seq === null ? (
          <Pressable
            key={k.label}
            style={({ pressed }) => [s.key, props.ctrlArmed && s.armed, pressed && s.keyPressed]}
            accessibilityRole="button"
            accessibilityState={{ selected: props.ctrlArmed }}
            onPress={props.onCtrl}
          >
            <Text style={[s.keyText, props.ctrlArmed && s.armedText]}>Ctrl</Text>
          </Pressable>
        ) : (
          <Pressable key={k.label} style={({ pressed }) => [s.key, pressed && s.keyPressed]} accessibilityRole="button" accessibilityLabel={k.seq === ENTER ? t.enter : k.label} onPress={() => props.onKey(k.seq)}>
            <Text style={s.keyText}>{k.label}</Text>
          </Pressable>
        ),
      )}
      <Pressable style={({ pressed }) => [s.key, pressed && s.keyPressed]} accessibilityRole="button" onPress={props.onPaste}>
        <Text style={s.keyText}>{t.paste}</Text>
      </Pressable>
    </View>
  );
}

// What Claude has not read yet, in the order it will. What is in Claude's own queue waits for its next step;
// what the Mac holds can be taken back to change, moved or dropped. Each action resolves to whether the Mac did it.
// While one is on its way the message takes no other, and the button pressed spins; one that takes the
// message out of the queue spins on until the Mac's list no longer has it.
type Doing = 'edit' | 'sendNow' | 'up' | 'down' | 'drop';
const LEAVES: Doing[] = ['edit', 'sendNow', 'drop'];
export function QueueTray(props: {
  queued: InQueue[];
  why: string;
  onSendNow?: (q: Queued) => Promise<boolean>;
  onMove: (q: Queued, by: -1 | 1) => Promise<boolean>;
  onEdit: (q: Queued) => Promise<boolean>;
  onDrop: (q: Queued) => Promise<boolean>;
}) {
  const s = useStyles();
  const who = useAgentName();
  const [open, setOpen] = useState<string | null>(null);
  const [doing, setDoing] = useState<ReadonlyMap<string, Doing>>(() => new Map());
  const settle = (id: string) =>
    setDoing((was) => {
      const now = new Map(was);
      now.delete(id);
      return now;
    });
  const run = (q: Queued, what: Doing, action: (q: Queued) => Promise<boolean>) => {
    if (doing.has(q.id)) return;
    setDoing((was) => new Map(was).set(q.id, what));
    void action(q).then((done) => (done && LEAVES.includes(what) ? undefined : settle(q.id)));
  };
  // The button for `what` on a message: spinning while it is on its way, held while another is.
  const state = (id: string, what: Doing) => ({ busy: doing.get(id) === what, disabled: doing.has(id) && doing.get(id) !== what });
  if (!props.queued.length) return null;
  // Only what the Mac holds can be moved, among itself.
  const macs = props.queued.filter((q) => q.waits === 'mac');
  return (
    <View style={s.queue} accessibilityLabel={t.queuedMessages}>
      <View style={s.queueHead}>
        <Text style={s.queueTitle}>{t.queued(props.queued.length)}</Text>
        <Text style={s.queueWhy} numberOfLines={1}>
          {props.why}
        </Text>
      </View>
      {props.queued.map((q, i) => (
        <View key={q.id} style={s.queueItem}>
          <View style={s.queueRow}>
            <Text style={s.queueN}>{i + 1}</Text>
            <Text style={s.queueText} numberOfLines={open === q.id ? undefined : 1} onPress={() => setOpen(open === q.id ? null : q.id)}>
              {mineInBrief(q.text)}
            </Text>
            {q.waits !== 'mac' ? (
              <Text style={s.queueWaits}>{q.waits === 'sending' ? t.sending : t.inAgentsQueue(who)}</Text>
            ) : (
              <>
                <Button small label={t.edit} {...state(q.id, 'edit')} onPress={() => run(q, 'edit', props.onEdit)} />
                {props.onSendNow && <Button small label={t.sendNow} {...state(q.id, 'sendNow')} onPress={() => run(q, 'sendNow', props.onSendNow!)} />}
              </>
            )}
          </View>
          {open === q.id && q.waits === 'mac' && (
            <View style={s.queueActions}>
              <Button small label={t.moveUp} {...state(q.id, 'up')} disabled={q.id === macs[0]?.id || state(q.id, 'up').disabled} onPress={() => run(q, 'up', (m) => props.onMove(m, -1))} />
              <Button
                small
                label={t.moveDown}
                {...state(q.id, 'down')}
                disabled={q.id === macs.at(-1)?.id || state(q.id, 'down').disabled}
                onPress={() => run(q, 'down', (m) => props.onMove(m, 1))}
              />
              <Button small kind="danger" label={t.delete} {...state(q.id, 'drop')} onPress={() => run(q, 'drop', props.onDrop)} />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const MARK: Record<string, string> = { completed: '✓', in_progress: '●' };

// Claude's task list while any of it is left: how far along, what it is on now, and the whole list when opened.
export function TaskBar({ tasks }: { tasks: Task[] }) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const done = tasks.filter((x) => x.status === 'completed').length;
  if (!tasks.length || done === tasks.length) return null;
  const now = tasks.find((x) => x.status === 'in_progress');
  return (
    <Pressable style={s.tasks} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <View style={s.tasksHead}>
        <Text style={s.tasksCount}>{t.tasks(done, tasks.length)}</Text>
        <Text style={s.tasksNow} numberOfLines={1}>
          {now ? t.taskNow(now.subject) : t.taskNotStarted}
        </Text>
      </View>
      {open &&
        tasks.map((x, i) => (
          <Text key={i} style={[s.task, x.status === 'completed' && s.taskDone, x.status === 'in_progress' && s.taskNowText]}>
            {MARK[x.status] ?? '○'} {x.subject}
          </Text>
        ))}
    </Pressable>
  );
}

// The session's screen on the Mac as it is right now, as text, for what the chat cannot make out. The Mac
// pushes it on the session's line each time it changes; when the line is not live it is asked for, one
// request at a time. With keys it can be answered while watched.
export function ScreenSheet(props: {
  sessionId: string;
  onClose: () => void;
  keys?: Keys;
}) {
  const { sessionId, onClose, keys } = props;
  const s = useStyles();
  const { text, failed, refresh, keyed } = useScreenText(api, sessionId, () => AppState.currentState === 'active');
  // Opened at the bottom, where the prompt is; after that it stays where it is being read.
  const screen = useRef<ScrollView>(null);
  const placed = useRef(false);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.sheet}>
        <View style={s.sheetHead}>
          <Text style={s.sheetTitle}>{t.screenTitle}</Text>
          <Button
            small
            label={t.refresh}
            onPress={refresh}
          />
          <CloseButton onPress={onClose} />
        </View>
        {failed && <Text style={s.alert}>{t.screenUnread}</Text>}
        {text === null && <View style={s.screen}>{!failed && <Text style={s.muted}>{t.reading}</Text>}</View>}
        {text !== null && (
          <ScrollView
            ref={screen}
            style={s.screen}
            accessibilityLabel={t.screenContent}
            onContentSizeChange={() => {
              if (placed.current) return;
              placed.current = true;
              screen.current?.scrollToEnd({ animated: false });
            }}
          >
            <ScrollView horizontal>
              <Text style={s.screenText} selectable>
                {text ? asText(text) : t.screenEmpty}
              </Text>
            </ScrollView>
          </ScrollView>
        )}
        {keys && (
          <KeyBar
            ctrlArmed={keys.ctrlArmed}
            onCtrl={keys.onCtrl}
            onPaste={() => {
              keys.onPaste();
              keyed();
            }}
            onKey={(seq) => {
              keys.onKey(seq);
              keyed();
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    // Its own height only: a scroll view grows to share what is left with the one above it.
    keybar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    key: { minWidth: 44, height: 38, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
    keyPressed: { backgroundColor: c.border },
    armed: { backgroundColor: c.accent, borderColor: c.accent },
    keyText: { fontFamily: MONO, fontWeight: '600', fontSize: fs(14), color: c.text },
    armedText: { color: c.accentText },
    queue: { gap: 4, maxHeight: 280 },
    queueHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 4 },
    queueTitle: { fontSize: fs(13), fontWeight: '700', color: c.text },
    queueWhy: { flex: 1, fontSize: fs(12), color: c.muted },
    queueItem: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, borderRadius: 12 },
    queueRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingRight: 6, paddingLeft: 10, minHeight: 40 },
    // At the end of the row, as far in as the number is at its start.
    queueWaits: { paddingLeft: 6, paddingRight: 4, fontSize: fs(12), color: c.muted },
    queueN: { fontSize: fs(12), color: c.muted, fontVariant: ['tabular-nums'] },
    queueText: { flex: 1, paddingVertical: 6, fontSize: fs(14), color: c.text },
    queueActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingRight: 6, paddingBottom: 6, paddingLeft: 28 },
    tasks: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: c.surface2, gap: 4 },
    tasksHead: { flexDirection: 'row', gap: 8, alignItems: 'baseline' },
    tasksCount: { fontSize: fs(13), fontWeight: '600', color: c.text },
    tasksNow: { flex: 1, fontSize: fs(13), color: c.muted },
    task: { fontSize: fs(13), color: c.muted },
    taskDone: { textDecorationLine: 'line-through' },
    taskNowText: { color: c.text },
    sheet: { flex: 1, backgroundColor: c.surface, padding: 16, gap: 10 },
    sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sheetTitle: { flex: 1, fontSize: fs(17), fontWeight: '700', color: c.text },
    alert: { color: c.danger, fontSize: fs(14) },
    muted: { color: c.muted, fontSize: fs(15), textAlign: 'center', paddingVertical: 20 },
    screen: { flex: 1, borderRadius: 8, backgroundColor: c.surface2 },
    screenText: { padding: 10, fontFamily: MONO, fontSize: fs(12), lineHeight: fs(12) * 1.35, color: c.text },
  });

// iOS draws some of the terminal's marks (⏺) as colour emoji; the text variation selector keeps them plain.
const asText = (s: string) => s.replace(/[⏺⏸⏹]/g, '$&\uFE0E');
