import { t } from '@workoffdesk/i18n';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { bareHeader } from '../components/header';
import { GearButton, SessionList } from '../components/SessionList';
import { useSplit } from '../hooks';
import { useTheme, type Theme } from '../theme';

// The sessions, the page at the bottom of the stack. On a screen wide enough for the list to stay on the left
// (_layout.tsx), this page is what is beside it before a session is opened.
export default function Sessions() {
  const [query, setQuery] = useState('');
  if (useSplit()) return <ChooseSession />;
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          ...bareHeader({
            left: { type: 'custom', element: <GearButton /> },
            // The bar's first item is its rightmost.
            right: [
              { type: 'button', label: t.newSession, icon: { type: 'sfSymbol', name: 'plus.circle' }, onPress: () => router.push('/new-session') },
              { type: 'button', label: t.conversationsOnMac, icon: { type: 'sfSymbol', name: 'clock.arrow.circlepath' }, onPress: () => router.push('/conversations') },
            ],
          }),
          headerSearchBarOptions: {
            placeholder: t.search,
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            hideWhenScrolling: false,
          },
        }}
      />
      <SessionList query={query} />
    </>
  );
}

function ChooseSession() {
  const theme = useTheme();
  const st = useMemo(() => styles(theme), [theme]);
  return (
    <View style={st.page}>
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={st.say}>{t.chooseSession}</Text>
    </View>
  );
}

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    page: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: c.bg },
    say: { color: c.muted, fontSize: fs(15), textAlign: 'center' },
  });
