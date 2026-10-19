import type { Panel } from '@workoffdesk/client/model/chat';
import { taskKeys, TASK_BACK, TASK_STOP } from '@workoffdesk/client/chat/panel';
import { t } from '@workoffdesk/i18n';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MONO, useTheme, type Theme } from '../../theme';
import { Button } from '../ui';

const said = (words: Record<string, string>, w: string) => words[w] ?? w;

// Claude Code's /tasks: its list, each task with its own buttons, or one task opened, with the way back.
export function TasksPanel({ panel, press }: { panel: Panel; press: (keys: string) => void }) {
  const s = useTaskStyles();
  const { tasks, task } = panel;
  if (tasks) {
    if (!tasks.rows.length) return <Text style={s.none}>{t.tasksNone}</Text>;
    return (
      <View style={s.rows}>
        {tasks.rows.map((row, i) => (
          <View key={`${i}-${row.label}`} style={s.row}>
            <View style={s.what}>
              <Text style={s.label} numberOfLines={2} selectable>
                {row.label}
              </Text>
              {!!row.status && <Text style={s.status}>{said(t.taskStatus, row.status)}</Text>}
            </View>
            <View style={s.buttons}>
              <Button small label={t.taskOutput} onPress={() => press(taskKeys(tasks, i, 'view'))} />
              <Button small kind="danger" label={t.stop} onPress={() => press(taskKeys(tasks, i, 'stop'))} />
            </View>
          </View>
        ))}
      </View>
    );
  }
  if (!task) return null;
  return (
    <View style={s.rows}>
      {task.fields.map((f) => (
        <View key={f.name} style={s.field}>
          <Text style={s.fieldName}>{said(t.taskFields, f.name)}</Text>
          <Text style={f.name === 'Command' ? s.mono : s.value} selectable>
            {f.name === 'Status' ? said(t.taskStatus, f.value) : f.value}
          </Text>
        </View>
      ))}
      {!!task.output && (
        <View style={s.output}>
          <Text style={s.mono} selectable>
            {task.output}
          </Text>
        </View>
      )}
      <View style={s.buttons}>
        <Button small label={t.taskBack} onPress={() => press(TASK_BACK)} />
        <Button small kind="danger" label={t.stop} onPress={() => press(TASK_STOP)} />
      </View>
    </View>
  );
}

function useTaskStyles() {
  const theme = useTheme();
  return useMemo(() => taskStyles(theme), [theme]);
}

const taskStyles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    rows: { gap: 10 },
    row: { gap: 8, padding: 10, borderRadius: 10, backgroundColor: c.surface2 },
    what: { gap: 2 },
    label: { fontFamily: MONO, fontSize: fs(13), color: c.text },
    status: { fontSize: fs(12), color: c.muted },
    buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    none: { textAlign: 'center', fontSize: fs(14), color: c.muted, paddingVertical: 12 },
    field: { flexDirection: 'row', gap: 10 },
    fieldName: { width: 64, fontSize: fs(13), color: c.muted },
    value: { flex: 1, fontSize: fs(13), color: c.text },
    mono: { flex: 1, fontFamily: MONO, fontSize: fs(12), lineHeight: fs(12) * 1.45, color: c.text },
    output: { padding: 8, borderRadius: 10, backgroundColor: c.surface2 },
  });
