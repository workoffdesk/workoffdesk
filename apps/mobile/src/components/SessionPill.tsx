import type { Usage } from '@workoffdesk/client/base/api';
import { effortName, effortsOf, EFFORTS, modelItems } from '@workoffdesk/client/model/chat';
import { MODES, modeName } from '@workoffdesk/client/composer/modes';
import { pillFigure, usageLines, usageText, type PillFigure, type SessionPillProps } from '@workoffdesk/client/mac/usage';
import { t } from '@workoffdesk/i18n';
import * as Clipboard from 'expo-clipboard';
import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme, type Theme } from '../theme';
import { Popup } from './Popup';
import { Button } from './ui';

const COPIED_MS = 1500;

type Item = { label: string; current?: boolean; sub?: string; pick: () => void };

function useStyles() {
  const theme = useTheme();
  return useMemo(() => styles(theme), [theme]);
}

// A figure as wide as any percentage, for the context's part.
const widestFigure = (label: string) => label.replace(/\d+/g, '100');

// A part of the pill. It keeps the room of the longest label it may show, so the parts beside it stay put
// as its label changes; while `busy` it spins over its label.
function Part(props: {
  label: string;
  widest: string[];
  accessibilityLabel: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  tone?: 'muted' | 'danger';
}) {
  const s = useStyles();
  const { c } = useTheme();
  const tone = props.tone === 'muted' ? s.muted : props.tone === 'danger' ? s.danger : null;
  return (
    <Pressable
      style={s.part}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ busy: !!props.busy, disabled: !!props.disabled, expanded: props.expanded }}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      {props.widest.map((w) => (
        <Text key={w} style={[s.partText, s.room]} numberOfLines={1} aria-hidden>
          {w}
        </Text>
      ))}
      <Text style={[s.partText, tone, (props.busy || props.disabled) && s.faded]} numberOfLines={1}>
        {props.label}
      </Text>
      {props.busy && <ActivityIndicator style={StyleSheet.absoluteFill} size="small" color={c.text} />}
    </Pressable>
  );
}

// A part of the pill that opens its menu in the middle of the screen, as Claude Code's own dialogs do on this
// page (Popup.tsx); it closes on a pick or a tap on the dimmed page.
function KeyMenu(props: {
  label: string;
  widest: string[];
  title: string;
  accessibilityLabel: string;
  tone?: 'muted' | 'danger';
  busy?: boolean;
  items?: Item[];
  children?: (close: () => void) => ReactNode;
}) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Part
        label={props.label}
        widest={props.widest}
        accessibilityLabel={props.accessibilityLabel}
        tone={props.tone}
        busy={props.busy}
        disabled={props.busy}
        expanded={open}
        onPress={() => setOpen(true)}
      />
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Popup onClose={close}>
          <View style={s.menu} accessibilityRole="menu">
            <Text style={s.title}>{props.title}</Text>
            {props.children?.(close)}
            <ScrollView style={s.menu} contentContainerStyle={s.items} bounces={false}>
              {props.items?.map((it) => (
                <Pressable
                  key={it.label}
                  style={({ pressed }) => [s.item, it.current && s.itemCurrent, pressed && s.pressed]}
                  accessibilityRole="menuitem"
                  accessibilityState={{ checked: !!it.current }}
                  onPress={() => {
                    close();
                    if (!it.current) it.pick();
                  }}
                >
                  <View style={s.itemBody}>
                    <Text style={[s.itemText, it.current && s.current]}>{it.label}</Text>
                    {!!it.sub && <Text style={s.sub}>{it.sub}</Text>}
                  </View>
                  {it.current && <Text style={s.current}>✓</Text>}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Popup>
      </Modal>
    </>
  );
}

// Under the composer, as one pill: the model, the permission mode, the effort and the context used, each
// opening a menu in the middle of the screen. A pick is typed as the command with what it takes
// (`/effort high`), which opens no dialog.
export function SessionPill(
  props: SessionPillProps & {
    // The command pressed whose dialog has not shown; until it does, none is pressed.
    commanding?: string | null;
  },
) {
  const s = useStyles();
  const u = props.usage ?? {};
  const figure = pillFigure(u);
  const { mode, commanding } = props;
  if (props.fixed)
    return (
      <View style={s.foot}>
        <View style={s.pill}>
          <View style={s.part} accessibilityLabel={t.modelIs(u.model ?? t.unknown)}>
            <Text style={s.partText} numberOfLines={1}>{u.model ?? t.model}</Text>
          </View>
          {!!u.effort && (
            <>
              <Text style={s.muted}>·</Text>
              <View style={s.part} accessibilityLabel={t.effortIs(effortName(u.effort))}>
                <Text style={s.partText} numberOfLines={1}>{effortName(u.effort)}</Text>
              </View>
            </>
          )}
          {figure && <UsageKey usage={u} figure={figure} account={props.account} />}
        </View>
      </View>
    );
  const modeLabel = props.switching ? t.switchingMode : mode === undefined ? t.permissions : modeName(mode);
  const running = (command: string) => commanding === command || !!commanding?.startsWith(`${command} `);
  return (
    <View style={s.foot}>
      <View style={s.pill}>
        <KeyMenu
          label={u.model ?? t.model}
          widest={[t.model]}
          title={t.panelTitles.Model}
          accessibilityLabel={t.modelIs(u.model ?? t.unknown)}
          busy={running('/model')}
          items={modelItems(props.models, u.model).map((m) => ({ ...m, pick: () => props.onCommand(m.command) }))}
        />
        <Text style={s.muted}>·</Text>
        <KeyMenu
          label={modeLabel}
          widest={[...MODES.map((m) => m.name), t.switchingMode, t.permissions]}
          title={t.permissions}
          accessibilityLabel={t.permissionsIs(mode === undefined ? t.unknown : modeName(mode))}
          tone={mode === 'bypass permissions' ? 'danger' : undefined}
          busy={props.switching}
          items={MODES.map((m) => ({ label: m.name, current: m.mode === mode, pick: () => props.onMode(m.mode) }))}
        />
        {!!u.effort && (
          <>
            <Text style={s.muted}>·</Text>
            <KeyMenu
              label={effortName(u.effort)}
              widest={EFFORTS.map(effortName)}
              title={t.panelTitles.Effort}
              accessibilityLabel={t.effortIs(effortName(u.effort))}
              busy={running('/effort')}
              items={effortsOf(props.models, u.model).map((level) => ({ label: effortName(level), current: level === u.effort, pick: () => props.onCommand(`/effort ${level}`) }))}
            />
          </>
        )}
        {figure && <UsageKey usage={u} figure={figure} account={props.account} />}
      </View>
    </View>
  );
}

// The context used, or a limit running out, shown in the pill (usage.ts); a tap opens what else the session
// has used.
function UsageKey({ usage: u, figure, account }: { usage: Usage; figure: PillFigure; account?: string }) {
  const s = useStyles();
  const [copied, setCopied] = useState(false);
  const lines = usageLines(u, undefined, account);
  const copy = () =>
    void Clipboard.setStringAsync(usageText(u, lines)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  return (
    <KeyMenu
      label={figure.label}
      widest={[widestFigure(figure.label)]}
      title={t.panelTitles.Usage}
      accessibilityLabel={figure.accessibilityLabel}
      tone={figure.high ? 'danger' : 'muted'}
    >
      {() => (
        <View>
          {lines.map((l) => (
            <View key={l.label} style={s.usageRow}>
              <Text style={s.usageLabel}>{l.label}</Text>
              <View style={s.usageValue}>
                <Text style={[s.usageFigure, l.high && s.danger]}>{l.value}</Text>
                {!!l.sub && <Text style={s.sub}>{l.sub}</Text>}
              </View>
            </View>
          ))}
          <Button label={copied ? t.copied : t.copyUsage} onPress={copy} style={s.copy} />
        </View>
      )}
    </KeyMenu>
  );
}

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    foot: { flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 2 },
    pill: { flexDirection: 'row', alignItems: 'center', maxWidth: '100%', minHeight: 32, paddingHorizontal: 6, borderRadius: 16, backgroundColor: c.surface2 },
    // A column: the labels that only keep its room give it their width and no height.
    part: { minHeight: 32, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
    room: { height: 0, opacity: 0 },
    faded: { opacity: 0.3 },
    partText: { fontSize: fs(13), color: c.text, fontVariant: ['tabular-nums'] },
    muted: { fontSize: fs(13), color: c.muted },
    danger: { color: c.danger },
    title: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 12, textAlign: 'center', fontSize: fs(17), fontWeight: '600', color: c.text },
    menu: { flexShrink: 1 },
    items: { gap: 8 },
    item: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 25, backgroundColor: c.surface2 },
    itemBody: { flex: 1, gap: 2 },
    itemCurrent: { borderWidth: 1.5, borderColor: c.accent },
    pressed: { backgroundColor: c.border },
    itemText: { fontSize: fs(15), color: c.text },
    current: { fontSize: fs(15), color: c.accent, fontWeight: '600' },
    sub: { fontSize: fs(12), color: c.muted },
    usageRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 8, paddingHorizontal: 12 },
    usageLabel: { fontSize: fs(14), color: c.text },
    usageValue: { flexShrink: 1, alignItems: 'flex-end' },
    usageFigure: { fontSize: fs(14), fontWeight: '600', color: c.text, fontVariant: ['tabular-nums'] },
    copy: { marginTop: 12 },
  });
