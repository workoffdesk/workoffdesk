import type { Background } from '@workoffdesk/client/journal/journalRows';
import { t } from '@workoffdesk/i18n';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../ui';
import { S } from './styles';

// The commands Claude runs in the background; Manage opens Claude Code's own /tasks dialog, which stops them.
export function BackgroundBar({ running, onManage, s }: { running: Background[]; onManage: () => void; s: S }) {
  const [open, setOpen] = useState(false);
  if (!running.length) return null;
  return (
    <View style={s.bg}>
      <View style={s.bgRow}>
        <Pressable style={s.bgToggle} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
          <Text style={s.bgHead}>
            {open ? '▾' : '▸'} <Text style={s.bold}>{t.runningInBackground}</Text> {t.backgroundRunning(running.length)}
          </Text>
        </Pressable>
        <Button small label={t.manageBackground} onPress={onManage} />
      </View>
      {open &&
        running.map((b) => (
          <Text key={b.id} style={s.bgItem} numberOfLines={1}>
            {b.label} <Text style={s.muted}>#{b.id}</Text>
          </Text>
        ))}
    </View>
  );
}

export function Overlay({ title, sub, children, s }: { title: string; sub: string; children?: ReactNode; s: S }) {
  return (
    <View style={s.overlay}>
      <View style={s.overlayCard}>
        <Text style={s.overlayTitle}>{title}</Text>
        <Text style={[s.muted, s.center]}>{sub}</Text>
        {children}
      </View>
    </View>
  );
}
