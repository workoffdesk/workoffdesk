import { serverBase } from '@workoffdesk/client/base/api';
import { loginErrorText } from '@workoffdesk/client/base/login';
import { t } from '@workoffdesk/i18n';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../client';
import { carryNotifications } from '../notifications';
import { tint, useTheme, type Theme } from '../theme';

// With onCancel, another account, on this server or another, is signed in to, or (again) one kept whose Mac
// no longer takes its login: the one in use stays in use until that one lets the phone in, and Cancel goes
// back to it.
export function LoginForm({ onCancel, again }: { onCancel?: () => void; again?: { server: string; user: string } }) {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const [server, setServer] = useState(() => again?.server ?? auth.lastServer());
  const [username, setUsername] = useState(again?.user ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const adding = !!onCancel;
  const userField = useRef<TextInput>(null);
  const passwordField = useRef<TextInput>(null);

  const submit = async () => {
    const base = serverBase(server);
    if (!base) {
      Keyboard.dismiss();
      return setError(t.badServerAddress);
    }
    if (!username || !password || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    try {
      await carryNotifications((leaving) => auth.signIn(base, username, password, leaving));
    } catch (e) {
      setError(loginErrorText(e));
      setBusy(false);
    }
  };

  // The password goes first: one left in a field as it closes is offered to the Passwords app.
  const cancel = () => {
    setPassword('');
    setTimeout(() => onCancel?.(), 0);
  };

  const { c } = theme;
  return (
    <SafeAreaView style={s.page}>
      {/* The keyboard pushes the form up and can be dragged or tapped away, so Log in and what it says stay in reach. */}
      <ScrollView
        style={s.page}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <Pressable style={s.form} onPress={Keyboard.dismiss} accessible={false}>
          <View style={s.card}>
            <View style={s.brand}>
              <Image source={require('../../assets/icon.png')} style={s.logo} />
              <Text style={s.title}>WorkOffDesk</Text>
              <Text style={s.tagline}>{again ? t.signInAgainTagline : adding ? t.addAccountTagline : t.tagline}</Text>
            </View>
            <View style={s.field}>
              <Text style={s.label}>{t.serverAddress}</Text>
              <TextInput
                style={s.input}
                value={server}
                accessibilityLabel={t.serverAddress}
                testID="server"
                onChangeText={setServer}
                placeholder="https://workoffdesk.example.com"
                placeholderTextColor={c.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                textContentType="URL"
                returnKeyType="next"
                onSubmitEditing={() => userField.current?.focus()}
                submitBehavior="submit"
              />
              <Text style={s.hint}>{t.serverAddressHint}</Text>
            </View>
            <View style={s.field}>
              <Text style={s.label}>{t.username}</Text>
              <TextInput
                ref={userField}
                style={s.input}
                value={username}
                accessibilityLabel={t.username}
                testID="username"
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                textContentType="username"
                returnKeyType="next"
                onSubmitEditing={() => passwordField.current?.focus()}
                submitBehavior="submit"
              />
            </View>
            <View style={s.field}>
              <Text style={s.label}>{t.password}</Text>
              <TextInput
                ref={passwordField}
                style={s.input}
                value={password}
                accessibilityLabel={t.password}
                testID="password"
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={submit}
              />
            </View>
            {error && (
              <Text style={s.alert} accessibilityRole="alert">
                {error}
              </Text>
            )}
            <Pressable
              style={({ pressed }) => [s.button, (busy || !server || !username || !password) && s.disabled, pressed && s.pressed]}
              disabled={busy || !server || !username || !password}
              onPress={submit}
              accessibilityRole="button"
            >
              {busy ? <ActivityIndicator color={c.accentText} /> : <Text style={s.buttonText}>{t.login}</Text>}
            </Pressable>
            {adding && (
              <Pressable style={({ pressed }) => [s.cancel, pressed && s.pressed]} disabled={busy} onPress={cancel} accessibilityRole="button">
                <Text style={s.cancelText}>{t.cancel}</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.bg },
    scroll: { flexGrow: 1 },
    form: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 24 },
    card: { width: '100%', maxWidth: 360, alignSelf: 'center', gap: 14 },
    brand: { alignItems: 'center', gap: 10, marginBottom: 18 },
    logo: { width: 64, height: 64, borderRadius: 16 },
    title: { fontSize: fs(26), fontWeight: '700', color: c.text, letterSpacing: -0.5 },
    tagline: { fontSize: fs(15), color: c.muted },
    field: { gap: 6 },
    label: { fontSize: fs(14), color: c.muted },
    hint: { fontSize: fs(13), color: c.muted },
    input: {
      height: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      paddingHorizontal: 14,
      fontSize: Math.max(16, fs(16)),
      color: c.text,
    },
    alert: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, fontSize: fs(14), color: c.danger, backgroundColor: tint(c.danger, 14), overflow: 'hidden' },
    button: { minHeight: 48, borderRadius: 12, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
    buttonText: { color: c.accentText, fontWeight: '600', fontSize: fs(16) },
    cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    cancelText: { color: c.accent, fontSize: fs(16) },
    disabled: { opacity: 0.55 },
    pressed: { opacity: 0.85 },
  });
