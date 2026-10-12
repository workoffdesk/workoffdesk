import { timeAgo } from '@workoffdesk/client/model/format';
import { opWords, type ClaudeAccounts, type MacCheck, type MacOp, type MacProblem, type MacReport } from '@workoffdesk/client/mac/macPage';
import { accountBar, accountLine } from '@workoffdesk/client/mac/usage';
import { t } from '@workoffdesk/i18n';
import { useCopied } from '@workoffdesk/react/copied';
import { useMacPage } from '@workoffdesk/react/macPage';
import * as Clipboard from 'expo-clipboard';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../client';
import { PageHeader } from '../components/header';
import { Button } from '../components/ui';
import { tint, useTheme, type Theme } from '../theme';

type S = ReturnType<typeof styles>;

function Section({ title, children, s }: { title: string; children: ReactNode; s: S }) {
  return (
    <View style={s.section}>
      <Text style={s.h2}>{title}</Text>
      <View style={s.group}>{children}</View>
    </View>
  );
}

function Check({ check, s, theme }: { check: MacCheck; s: S; theme: Theme }) {
  const [copied, setCopied] = useCopied();
  return (
    <View style={[s.row, s.top]}>
      <View style={[s.dot, { backgroundColor: check.ok ? theme.c.idle : theme.c.danger }]} />
      <View style={s.rowMain}>
        <Text style={s.strong}>{t.checkNames[check.id] ?? check.id}</Text>
        <Text style={s.sub}>{check.detail}</Text>
        {check.fix && (
          <Pressable
            accessibilityRole="button"
            accessibilityHint={t.macFixTap}
            style={({ pressed }) => [s.fix, pressed && s.pressed]}
            onPress={() => void Clipboard.setStringAsync(check.fix!).then(() => setCopied(true), () => {})}
          >
            <Text style={s.code} selectable>
              {check.fix}
            </Text>
            <Text style={s.hint}>{copied ? t.copied : t.macFixTap}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Checks({ report, s, theme }: { report: MacReport; s: S; theme: Theme }) {
  const [open, setOpen] = useState(false);
  const failed = report.checks.filter((c) => !c.ok);
  const passed = report.checks.filter((c) => c.ok);
  return (
    <Section title={t.macChecks} s={s}>
      {failed.map((c) => (
        <View key={c.id}>
          <Check check={c} s={s} theme={theme} />
          <View style={s.rule} />
        </View>
      ))}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} style={({ pressed }) => [s.row, pressed && s.pressed]} onPress={() => setOpen(!open)}>
        <View style={[s.dot, { backgroundColor: theme.c.idle, marginTop: 0 }]} />
        <Text style={[s.rowMain, s.sub]}>{failed.length ? t.macPassed(passed.length) : t.macAllPassed(passed.length)}</Text>
        <SymbolView name={open ? 'chevron.down' : 'chevron.right'} tintColor={theme.c.muted} size={14} />
      </Pressable>
      {open &&
        passed.map((c) => (
          <View key={c.id}>
            <View style={s.rule} />
            <Check check={c} s={s} theme={theme} />
          </View>
        ))}
    </Section>
  );
}

// Something that cannot be undone asks first, as ending a session does.
const confirm = (title: string, what: string, action: string, run: () => void, destructive: boolean) =>
  Alert.alert(title, what, [
    { text: t.cancel, style: 'cancel' },
    { text: action, style: destructive ? 'destructive' : 'default', onPress: run },
  ]);

function Actions(props: { report: MacReport; op: MacOp | null; restart: () => void; rollback: (to: string) => void; s: S; theme: Theme }) {
  const { report, op, s, theme } = props;
  const busy = op?.phase === 'asking' || op?.phase === 'waiting';
  const back = report.releases.find((r) => r.name === report.rollbackTo);
  const backName = back ? back.version || back.name : null;
  const opColor = !op ? theme.c.text : busy ? theme.c.working : op.phase === 'done' ? theme.c.idle : theme.c.danger;
  return (
    <Section title={t.macActions} s={s}>
      {op && (
        <>
          <View style={s.row} accessibilityRole="summary" accessibilityLiveRegion="polite">
            {busy && <ActivityIndicator color={theme.c.working} />}
            <Text style={[s.rowMain, s.strong, { color: opColor }]}>{opWords(op)}</Text>
          </View>
          <View style={s.rule} />
        </>
      )}
      {!report.managed ? (
        <View style={s.row}>
          <Text style={[s.rowMain, s.sub]}>{t.macNotManaged}</Text>
        </View>
      ) : (
        <>
          <View style={s.row}>
            <View style={s.rowMain}>
              <Text style={s.strong}>{t.macRestart}</Text>
              <Text style={s.sub}>{t.macRestartNote}</Text>
            </View>
            <Button small label={t.macRestartShort} disabled={busy} onPress={() => confirm(t.macRestart, t.macRestartNote, t.macRestartConfirm, props.restart, false)} />
          </View>
          <View style={s.rule} />
          <View style={s.row}>
            {backName && report.rollbackTo ? (
              <>
                <View style={s.rowMain}>
                  <Text style={s.strong}>{t.macRollback(backName)}</Text>
                  <Text style={s.sub}>{report.rollbackTo}</Text>
                </View>
                <Button
                  small
                  kind="danger"
                  label={t.macRollbackShort}
                  disabled={busy}
                  onPress={() => confirm(t.macRollback(backName), report.rollbackTo!, t.macRollbackShort, () => props.rollback(report.rollbackTo!), true)}
                />
              </>
            ) : (
              <Text style={[s.rowMain, s.sub]}>{t.macNoRollback}</Text>
            )}
          </View>
        </>
      )}
    </Section>
  );
}

// Shown only on a Mac with more than one account: a tap on one puts the sessions started next on it, and the open
// sessions on another account can be moved to it.
type AccountsProps = { accounts: ClaudeAccounts; picking: string | null; pick: (id: string) => void; moveAsked: boolean; move: () => void; s: S; theme: Theme };
function Accounts({ accounts, picking, pick, moveAsked, move, s, theme }: AccountsProps) {
  return (
    <View style={s.section}>
      <Text style={s.h2}>{t.macClaudeAccounts}</Text>
      <View style={s.group}>
        {accounts.accounts.map((a, i) => {
          const bar = accountBar(a);
          const inUse = a.id === accounts.inUse;
          return (
            <View key={a.id}>
              {i > 0 && <View style={s.rule} />}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: inUse, disabled: !!bar || picking !== null }}
                disabled={!!bar || inUse || picking !== null}
                onPress={() => pick(a.id)}
                style={({ pressed }) => [s.row, !!bar && s.barred, pressed && s.pressed]}
              >
                <View style={s.rowMain}>
                  <Text style={s.strong} numberOfLines={1}>
                    {a.email}
                  </Text>
                  <Text style={s.sub}>{accountLine(a)}</Text>
                </View>
                {picking === a.id ? <ActivityIndicator color={theme.c.muted} /> : inUse && <SymbolView name="checkmark" tintColor={theme.c.accent} size={17} />}
              </Pressable>
            </View>
          );
        })}
      </View>
      <Moves accounts={accounts} moveAsked={moveAsked} disabled={picking !== null} move={move} s={s} theme={theme} />
      {!accounts.elsewhere && !accounts.moving && <Text style={[s.hint, s.note]}>{t.macAccountNote}</Text>}
    </View>
  );
}

// The open sessions still on another account than the one in use: moving them to it, or the move under way.
type MovesProps = { accounts: ClaudeAccounts; moveAsked: boolean; disabled: boolean; move: () => void; s: S; theme: Theme };
function Moves({ accounts, moveAsked, disabled, move, s, theme }: MovesProps) {
  const to = accounts.accounts.find((a) => a.id === accounts.inUse)?.email ?? '';
  if (accounts.moving > 0)
    return (
      <View style={[s.move, { backgroundColor: tint(theme.c.working, 12) }]} accessibilityRole="summary" accessibilityLiveRegion="polite">
        <ActivityIndicator color={theme.c.working} />
        <View style={s.rowMain}>
          <Text style={[s.moveTitle, { color: theme.c.working }]}>{t.macMovingSessions(accounts.moving)}</Text>
          <Text style={s.sub}>{t.macMovingTo(to)}</Text>
        </View>
      </View>
    );
  if (!accounts.elsewhere) return null;
  return (
    <View style={[s.move, { backgroundColor: tint(theme.c.accent, 12) }]}>
      <View style={s.rowMain}>
        <Text style={[s.moveTitle, { color: theme.c.accent }]}>{t.macElsewhere(accounts.elsewhere)}</Text>
        <Text style={s.sub}>{t.macMoveTo(to)}</Text>
      </View>
      <Button small kind="primary" label={t.macMoveButton} busy={moveAsked} disabled={disabled} onPress={move} />
    </View>
  );
}

function Build({ report, s }: { report: MacReport; s: S }) {
  const current = report.releases.find((r) => r.name === report.release);
  const since = current?.activatedAt ? Date.parse(current.activatedAt) : NaN;
  return (
    <>
      <Section title={t.macVersion} s={s}>
        <View style={s.row}>
          <View style={s.rowMain}>
            <Text style={s.strong}>{report.version}</Text>
            {report.build?.commit && <Text style={s.sub}>{t.macBuiltFrom(report.build.commit.slice(0, 12), report.build.dirty)}</Text>}
            {!Number.isNaN(since) && <Text style={s.sub}>{t.macServingSince(timeAgo(since))}</Text>}
          </View>
        </View>
      </Section>
      {report.releases.length > 0 && (
        <Section title={t.macReleases} s={s}>
          {report.releases.map((r, i) => (
            <View key={r.name}>
              {i > 0 && <View style={s.rule} />}
              <View style={s.row}>
                <View style={s.rowMain}>
                  <View style={s.nameLine}>
                    <Text style={s.strong}>{r.version || r.name}</Text>
                    {r.name === report.release && <Text style={s.chip}>{t.macRunning}</Text>}
                  </View>
                  <Text style={s.sub}>
                    {r.name}
                    {r.activatedAt ? ` · ${timeAgo(Date.parse(r.activatedAt))}` : ''}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </Section>
      )}
    </>
  );
}

function Problem({ p, s, theme }: { p: MacProblem; s: S; theme: Theme }) {
  const [open, setOpen] = useState(false);
  const color = p.level === 'warn' ? theme.c.waiting : theme.c.danger;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={({ pressed }) => pressed && s.pressed}>
      <View style={s.row}>
        <Text style={[s.level, { color, backgroundColor: tint(color, 16) }]}>{p.level.toUpperCase()}</Text>
        <Text style={[s.rowMain, s.strong]} numberOfLines={open ? undefined : 1}>
          {p.msg || '—'}
        </Text>
        {(p.count ?? 1) > 1 && <Text style={s.count}>×{p.count}</Text>}
        <Text style={s.hint}>{timeAgo(Date.parse(p.at))}</Text>
      </View>
      {open && (
        <Text style={[s.code, s.detail]} selectable>
          {p.detail}
        </Text>
      )}
    </Pressable>
  );
}

export default function MacScreen() {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const { page, report, problems, error, op, accounts, picking, moveAsked, failed } = useMacPage(api);
  return (
    <View style={s.page}>
      <PageHeader title={<Text style={s.headerTitle}>{t.thisMac}</Text>} />
      <ScrollView style={s.page} contentContainerStyle={s.content} contentInsetAdjustmentBehavior="automatic">
        {error && (
          <View style={s.alertBox}>
            <Text style={s.alert} accessibilityRole="alert">
              {error}
            </Text>
            <Button small label={t.tryAgain} onPress={page.load} />
          </View>
        )}
        {!report && !error && <ActivityIndicator style={s.loading} color={theme.c.muted} />}
        {report && (
          <>
            <Text style={[s.summary, { color: failed ? theme.c.danger : theme.c.idle, backgroundColor: tint(failed ? theme.c.danger : theme.c.idle, 12) }]}>
              {failed ? t.macProblemCount(failed) : t.macAllGood}
            </Text>
            {accounts && accounts.accounts.length >= 2 && <Accounts accounts={accounts} picking={picking} pick={page.pick} moveAsked={moveAsked} move={page.move} s={s} theme={theme} />}
            <Checks report={report} s={s} theme={theme} />
            <Actions report={report} op={op} restart={page.restart} rollback={page.rollback} s={s} theme={theme} />
            <Build report={report} s={s} />
          </>
        )}
        {problems && (
          <View style={s.section}>
            <Text style={s.h2}>{t.macProblems}</Text>
            <View style={s.group}>
              {problems.length === 0 && (
                <View style={s.row}>
                  <Text style={[s.rowMain, s.sub]}>{t.macNoProblems}</Text>
                </View>
              )}
              {problems.map((p, i) => (
                <View key={`${p.at}-${i}`}>
                  {i > 0 && <View style={s.rule} />}
                  <Problem p={p} s={s} theme={theme} />
                </View>
              ))}
            </View>
            <Text style={[s.hint, s.note]}>{t.macLogNote}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const MONO = 'Menlo';

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.bg },
    headerTitle: { fontSize: fs(17), fontWeight: '600', color: c.text },
    content: { padding: 16, paddingBottom: 40, gap: 22 },
    loading: { marginTop: 48 },
    count: { fontSize: fs(12), fontWeight: '600', color: c.muted, fontVariant: ['tabular-nums'] },
    alertBox: { gap: 10, padding: 12, borderRadius: 10, backgroundColor: tint(c.danger, 12), alignItems: 'flex-start' },
    alert: { color: c.danger, fontSize: fs(15) },
    summary: { fontSize: fs(17), fontWeight: '600', padding: 14, borderRadius: 12, overflow: 'hidden' },
    section: { gap: 8 },
    h2: { fontSize: fs(13), fontWeight: '600', color: c.muted, paddingHorizontal: 4, textTransform: 'uppercase' },
    group: { borderRadius: 12, backgroundColor: c.surface, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 10, paddingHorizontal: 14 },
    top: { alignItems: 'flex-start' },
    rowMain: { flex: 1, gap: 2 },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    strong: { fontSize: fs(16), color: c.text },
    sub: { fontSize: fs(13), color: c.muted },
    hint: { fontSize: fs(12), color: c.muted },
    note: { paddingHorizontal: 4 },
    dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
    fix: { marginTop: 8, gap: 4, padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: c.surface2 },
    code: { fontFamily: MONO, fontSize: fs(13), color: c.text },
    detail: { paddingHorizontal: 14, paddingBottom: 12, color: c.muted, fontSize: fs(12) },
    level: { fontSize: fs(11), fontWeight: '700', paddingVertical: 1, paddingHorizontal: 6, borderRadius: 6, overflow: 'hidden' },
    chip: { fontSize: fs(11), fontWeight: '600', color: c.idle, backgroundColor: tint(c.idle, 16), paddingVertical: 1, paddingHorizontal: 6, borderRadius: 6, overflow: 'hidden' },
    move: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12 },
    moveTitle: { fontSize: fs(16), fontWeight: '600' },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 14 },
    pressed: { opacity: 0.6 },
    barred: { opacity: 0.45 },
  });
