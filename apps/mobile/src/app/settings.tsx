import { errorText } from '@workoffdesk/client/base/api';
import { deviceLabel, timeAgo } from '@workoffdesk/client/model/format';
import type { Listed } from '@workoffdesk/client/base/listed';
import { TEXT_MAX, TEXT_MIN, TEXT_STEP } from '@workoffdesk/client/settings/textSize';
import { t } from '@workoffdesk/i18n';
import { useGrouping, useLooks, useSignIns } from '@workoffdesk/react/settings';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Updates from 'expo-updates';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActionSheetIOS, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { api, auth, groupingChoice, snippets, themeChoice, type Login } from '../client';
import { useAccounts, useLogin } from '../hooks';
import { setTextSize, setTheme, tint, useTheme, type Theme } from '../theme';
import { PageHeader } from '../components/header';
import { Button } from '../components/ui';
import { carryNotifications, notifyOff, notifyOn, notifyState, type NotifyState } from '../notifications';
import { reopenHere, useUpdateReady } from '../appUpdate';
import { languageChoice } from '../language';

function Section({ title, children, s }: { title: string; children: ReactNode; s: ReturnType<typeof styles> }) {
  return (
    <View style={s.section}>
      <Text style={s.h2}>{title}</Text>
      <View style={s.group}>{children}</View>
    </View>
  );
}

// Starts the app again, saying how to by hand when it does not; done: once it did not.
function reopenOrSay(done?: () => void): void {
  reopenHere((why) => {
    done?.();
    Alert.alert(t.reopenStuck, why ? `${t.reopenStuckSub}\n\n${why}` : t.reopenStuckSub);
  });
}

// The colours and the app's language, each this device's own and following the phone until chosen: a row
// that says which, and opens the choices when tapped.
function Looks({ s, theme }: { s: ReturnType<typeof styles>; theme: Theme }) {
  const { colours, themes, pickTheme, language, languages, pickLanguage } = useLooks({ themeChoice, setTheme, languageChoice, restart: reopenOrSay });
  const { grouping, groupings, pickGrouping } = useGrouping(groupingChoice);
  return (
    <Section title={t.appearance} s={s}>
      <ChoiceRow label={t.theme} names={themes} value={colours} onPick={pickTheme} s={s} theme={theme} />
      <View style={s.rule} />
      <ChoiceRow label={t.language} note={t.languageRestarts} names={languages} value={language} onPick={pickLanguage} s={s} theme={theme} />
      <View style={s.rule} />
      <ChoiceRow label={t.listGrouping} names={groupings} value={grouping} onPick={pickGrouping} s={s} theme={theme} />
    </Section>
  );
}

function ChoiceRow<T extends string>(props: {
  label: string;
  note?: string;
  names: Record<T, string>;
  value: T;
  onPick: (v: T) => void;
  s: ReturnType<typeof styles>;
  theme: Theme;
}) {
  const { s, names } = props;
  const options = Object.keys(names) as T[];
  const open = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { title: props.label, message: props.note, options: [...options.map((o) => names[o]), t.cancel], cancelButtonIndex: options.length },
      (i) => i < options.length && props.onPick(options[i]),
    );
  return (
    <Pressable
      style={({ pressed }) => [s.row, pressed && { backgroundColor: props.theme.c.surface2 }]}
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${props.label}: ${names[props.value]}`}
    >
      <Text style={[s.strong, s.rowMain]}>{props.label}</Text>
      <Text style={s.value}>{names[props.value]}</Text>
      <SymbolView name="chevron.right" tintColor={props.theme.c.muted} size={14} />
    </Pressable>
  );
}

// What a list shows before it has rows: that it is on its way, or that it failed, with a retry.
function NotLoaded({ list, retry, s }: { list: Listed<unknown>; retry: () => void; s: ReturnType<typeof styles> }) {
  if (list.state === 'loading') return <Text style={[s.row, s.sub]}>{t.loading}</Text>;
  if (list.state === 'loaded') return null;
  return (
    <View style={s.row}>
      <Text style={[s.rowMain, s.failed]} accessibilityRole="alert">
        {list.error}
      </Text>
      <Button small label={t.tryAgain} onPress={retry} />
    </View>
  );
}

// Something that cannot be undone asks first, as ending a session does.
const confirm = (action: string, what: string, run: () => void) =>
  Alert.alert(action, what, [
    { text: t.cancel, style: 'cancel' },
    { text: action, style: 'destructive', onPress: run },
  ]);

// The server release whose update this app runs; none for the JS it was installed with.
function runningRelease(): string | null {
  const release = (Updates.manifest as { extra?: { expoClient?: { extra?: { release?: unknown } } } }).extra?.expoClient?.extra?.release;
  return typeof release === 'string' ? release : null;
}

const NOTIFY_NOTE: Partial<Record<NotifyState, string>> = { unready: t.pushAppUnready, denied: t.pushAppDenied };

function Notify({ s, busy, guard }: { s: ReturnType<typeof styles>; busy: boolean; guard: (fn: () => Promise<void>) => Promise<void> }) {
  const [state, setState] = useState<NotifyState | null>(null);
  useEffect(() => {
    void notifyState().then(setState, () => setState('unready'));
  }, []);
  const toggle = () => guard(async () => setState(state === 'on' ? await notifyOff() : await notifyOn()));
  const note = state && NOTIFY_NOTE[state];
  return (
    <Section title={t.pushTitle} s={s}>
      <View style={s.row}>
        <View style={s.rowMain}>
          <Text style={s.strong}>{t.pushRemind}</Text>
          <Text style={s.sub}>{t.pushRemindSub}</Text>
        </View>
        <Switch
          accessibilityLabel={t.pushTitle}
          value={state === 'on'}
          disabled={busy || (state !== 'on' && state !== 'off')}
          onValueChange={() => void toggle()}
        />
      </View>
      {note && (
        <>
          <View style={s.rule} />
          <Text style={[s.row, s.sub]}>{note}</Text>
        </>
      )}
    </Section>
  );
}

function Snippets({ s, theme }: { s: ReturnType<typeof styles>; theme: Theme }) {
  const [text, setText] = useState(snippets.text);
  return (
    <Section title={t.snippets} s={s}>
      <TextInput
        style={s.snippets}
        accessibilityLabel={t.snippetsLines}
        placeholder={t.snippetsPlaceholder}
        placeholderTextColor={theme.c.muted}
        multiline
        value={text}
        onChangeText={(v) => {
          setText(v);
          snippets.set(v);
        }}
        autoCorrect={false}
      />
      <View style={s.rule} />
      <Text style={[s.row, s.sub]}>{t.snippetsNote}</Text>
    </Section>
  );
}

export default function Settings() {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const login = useLogin();
  const accounts = useAccounts();
  const { passkeyList, loginList, passkeys, logins, load, retryPasskeys, retryLogins } = useSignIns(api);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const updateReady = useUpdateReady();
  const [reopening, setReopening] = useState(false);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e, t.failed));
    } finally {
      setBusy(false);
    }
  };
  const revoke = (handle: string) =>
    guard(async () => {
      await api(`/api/auth/logins/${handle}`, { method: 'DELETE' });
      await load();
    });

  const removePasskey = (id: string) =>
    guard(async () => {
      await api(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
    });

  // A phone that logs out stops getting that account's notifications; the next account kept, if any, takes them.
  const signOut = () =>
    carryNotifications(async (leaving) => {
      await leaving().catch(() => {});
      await auth.signOut();
    });

  // An account whose Mac no longer takes its login is signed in to again.
  const switchTo = (a: Login) =>
    guard(async () => {
      if (!(await carryNotifications((leaving) => auth.switchTo(a, leaving)))) router.push({ pathname: '/add-account', params: { server: a.server, user: a.user ?? '' } });
    });

  const size = theme.size;
  return (
    <View style={s.page}>
      <PageHeader title={<Text style={s.headerTitle}>{t.settings}</Text>} />
      <ScrollView style={s.page} contentContainerStyle={s.content} contentInsetAdjustmentBehavior="automatic">
      {error && (
        <Text style={s.alert} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {updateReady && (
        <View style={s.group}>
          <View style={s.row}>
            <View style={s.rowMain}>
              <Text style={s.strong}>{t.updateReady}</Text>
              <Text style={s.sub}>{t.updateReadySub}</Text>
            </View>
            <Button
              small
              kind="primary"
              label={t.updateNow}
              busy={reopening}
              onPress={() => {
                setReopening(true);
                reopenOrSay(() => setReopening(false));
              }}
            />
          </View>
        </View>
      )}
      <View style={s.group}>
        <Pressable style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]} onPress={() => router.push('/mac')} accessibilityRole="button">
          <View style={s.rowMain}>
            <Text style={s.strong}>{t.thisMac}</Text>
            <Text style={s.sub}>{t.thisMacSub}</Text>
          </View>
          <SymbolView name="chevron.right" tintColor={theme.c.muted} size={14} />
        </Pressable>
      </View>
      <Section title={t.textSize} s={s}>
        <View style={s.row}>
          <View style={s.rowMain}>
            <Text style={s.strong}>{t.wholeApp}</Text>
            <Text style={s.sub}>{t.thisDeviceOnly}</Text>
          </View>
          <View style={s.stepper}>
            <Button small label="A−" accessibilityLabel={t.smaller} disabled={size <= TEXT_MIN} onPress={() => setTextSize(size - TEXT_STEP)} />
            <Text style={s.size} accessibilityLabel={t.textSize}>
              {size}%
            </Text>
            <Button small label="A+" accessibilityLabel={t.larger} disabled={size >= TEXT_MAX} onPress={() => setTextSize(size + TEXT_STEP)} />
          </View>
        </View>
        <View style={s.rule} />
        <Text style={[s.row, s.preview]}>{t.textPreview}</Text>
      </Section>

      <Looks s={s} theme={theme} />

      <Notify s={s} busy={busy} guard={guard} />

      <Snippets s={s} theme={theme} />

      <Section title={t.account} s={s}>
        {accounts.map((a) => {
          const current = a.token === login?.token;
          return (
            <View key={a.token}>
              <View style={s.row}>
                <Pressable
                  style={s.rowMain}
                  disabled={current || busy}
                  onPress={() => void switchTo(a)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: current, disabled: current || busy }}
                >
                  {a.user && <Text style={s.strong}>{a.user}</Text>}
                  <Text style={a.user ? s.sub : s.strong} selectable={current}>
                    {a.server}
                  </Text>
                  {current && <Text style={s.sub}>{t.appRelease(runningRelease())}</Text>}
                </Pressable>
                {current ? (
                  <SymbolView name="checkmark" tintColor={theme.c.accent} size={20} />
                ) : (
                  <Button small kind="danger" label={t.removeAccount} disabled={busy} onPress={() => confirm(t.confirmRemoveAccount, a.user ?? a.server, () => void guard(() => auth.remove(a)))} />
                )}
              </View>
              <View style={s.rule} />
            </View>
          );
        })}
        <Pressable style={s.row} disabled={busy} onPress={() => router.push('/add-account')} accessibilityRole="button">
          <Text style={[s.rowMain, s.link]}>{t.addAccount}</Text>
        </Pressable>
      </Section>

      <Section title={t.passkeysTitle} s={s}>
        <NotLoaded
          list={passkeyList}
          retry={retryPasskeys}
          s={s}
        />
        {passkeys?.length === 0 && <Text style={[s.row, s.sub]}>{t.passkeyNoneOnPhone}</Text>}
        {passkeys?.map((p, i) => (
          <View key={p.id}>
            {i > 0 && <View style={s.rule} />}
            <View style={s.row} testID="passkey-row">
              <View style={s.rowMain}>
                <Text style={s.strong}>{p.name}</Text>
                <Text style={s.sub}>
                  {t.addedAgo(timeAgo(p.createdAt))}
                  {p.lastUsedAt ? t.lastUsedAgo(timeAgo(p.lastUsedAt)) : ''}
                </Text>
              </View>
              <Button small kind="danger" label={t.delete} disabled={busy} onPress={() => confirm(t.confirmDelete, p.name, () => void removePasskey(p.id))} />
            </View>
          </View>
        ))}
      </Section>

      <Section title={t.loggedIn} s={s}>
        <NotLoaded
          list={loginList}
          retry={retryLogins}
          s={s}
        />
        {logins?.map((l, i) => (
          <View key={l.handle}>
            {i > 0 && <View style={s.rule} />}
            <View style={s.row} testID="login-row">
              <View style={s.rowMain}>
                <View style={s.nameLine}>
                  <Text style={s.strong}>{deviceLabel(l.ua)}</Text>
                  {l.current && <Text style={s.chip}>{t.thisDevice}</Text>}
                </View>
                <Text style={s.sub}>{t.loginBy(l.method === 'passkey', timeAgo(l.lastSeen))}</Text>
              </View>
              {!l.current && <Button small kind="danger" label={t.revoke} disabled={busy} onPress={() => confirm(t.confirmRevoke, `${deviceLabel(l.ua)}\n${t.loginBy(l.method === 'passkey', timeAgo(l.lastSeen))}`, () => void revoke(l.handle))} />}
            </View>
          </View>
        ))}
      </Section>

      <View style={s.section}>
        <Button kind="danger" label={t.logOut} disabled={busy} onPress={() => void guard(signOut)} />
      </View>
      </ScrollView>
    </View>
  );
}

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.bg },
    headerTitle: { fontSize: fs(17), fontWeight: '600', color: c.text },
    content: { padding: 16, paddingBottom: 40, gap: 22 },
    alert: { color: c.danger, fontSize: fs(15), padding: 12, borderRadius: 10, backgroundColor: tint(c.danger, 12), overflow: 'hidden' },
    section: { gap: 8 },
    h2: { fontSize: fs(13), fontWeight: '600', color: c.muted, paddingHorizontal: 4, textTransform: 'uppercase' },
    group: { borderRadius: 12, backgroundColor: c.surface, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 10, paddingHorizontal: 14 },
    rowMain: { flex: 1, gap: 2 },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    strong: { fontSize: fs(16), color: c.text },
    sub: { fontSize: fs(13), color: c.muted },
    failed: { fontSize: fs(13), color: c.danger },
    link: { fontSize: fs(16), color: c.accent },
    chip: { fontSize: fs(11), fontWeight: '600', color: c.idle, backgroundColor: tint(c.idle, 16), paddingVertical: 1, paddingHorizontal: 6, borderRadius: 6, overflow: 'hidden' },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    size: { minWidth: 48, textAlign: 'center', fontSize: fs(15), color: c.text, fontVariant: ['tabular-nums'] },
    preview: { fontSize: fs(15), color: c.text, lineHeight: fs(15) * 1.45 },
    snippets: { minHeight: 120, paddingVertical: 12, paddingHorizontal: 14, fontSize: Math.max(16, fs(16)), color: c.text, textAlignVertical: 'top' },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 14 },
    value: { fontSize: fs(16), color: c.muted },
  });
