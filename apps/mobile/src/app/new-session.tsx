import { agentOf, type RecentConversation } from '@workoffdesk/client/base/api';
import { shortPath, timeAgo } from '@workoffdesk/client/model/format';
import { canPickUp, recentConversations, recentFound, recentNote } from '@workoffdesk/client/sessions/newSession';
import { into } from '@workoffdesk/client/sessions/projectSearch';
import { t } from '@workoffdesk/i18n';
import { useFetched } from '@workoffdesk/react/fetched';
import { useNewSession } from '@workoffdesk/react/newSession';
import { useProjectSearch } from '@workoffdesk/react/projectSearch';
import { router, Stack, useNavigation, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useRef, useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../client';
import { Button } from '../components/ui';
import { useTheme, type Theme } from '../theme';
import { backItem, bareHeader, closeItem } from '../components/header';

type S = ReturnType<typeof styles>;

const loadRecent = () => recentConversations(api);

function Option(props: { icon?: ComponentProps<typeof SymbolView>['name']; title: string; sub: string; disabled?: boolean; onPress: () => void; s: S }) {
  const { c } = useTheme();
  const { s } = props;
  return (
    <Pressable
      style={({ pressed }) => [s.option, pressed && s.pressed, props.disabled && s.dim]}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      {props.icon && <SymbolView name={props.icon} tintColor={c.accent} size={24} />}
      <View style={s.optionText}>
        <Text style={s.optionTitle} numberOfLines={2}>
          {props.title}
        </Text>
        {!!props.sub && (
          <Text style={s.optionSub} numberOfLines={2}>
            {props.sub}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// A new Claude or Codex from the phone: in a project folder, or picking up a conversation from this Mac,
// which is read first (claude/[sid], codex/[sid]).
export default function NewSession() {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const navigation = useNavigation();
  // Out of this sheet to where it led; nowhere once the sheet was swiped away meanwhile.
  const leave = (to: Href) => {
    if (!navigation.isFocused()) return;
    router.back();
    router.push(to);
  };
  const { step, setStep, busy, error, agent, codex, pick, run, title } = useNewSession(api, (made) =>
    leave({ pathname: '/session/[id]', params: { id: made.id } }),
  );
  return (
    <>
      <Stack.Screen
        options={{
          title,
          ...bareHeader({
            left: step === 'menu' ? null : backItem(() => setStep('menu')),
            right: closeItem(),
          }),
        }}
      />
      <ScrollView style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {error && <Text style={s.alert}>{error}</Text>}
        {step === 'menu' && (
          <>
            <Option icon="bubble.left" title={t.newInProject} sub={t.newInProjectSub} disabled={busy} onPress={() => pick('claude')} s={s} />
            <Option icon="clock.arrow.circlepath" title={t.resumeRecent} sub={t.resumeRecentSub} disabled={busy} onPress={() => setStep('recent')} s={s} />
            {codex && (
              <>
                <View style={s.rule} />
                <Option icon="terminal" title={t.newCodexInProject} sub={t.newCodexInProjectSub} disabled={busy} onPress={() => pick('codex')} s={s} />
              </>
            )}
          </>
        )}
        {step === 'project' && <Projects busy={busy} onPick={(cwd, name) => run({ kind: agent, cwd, title: name.trim() || undefined })} s={s} />}
        {step === 'recent' && (
          <Recent
            busy={busy}
            onPick={(r) =>
              leave(
                r.openIn
                  ? { pathname: '/session/[id]', params: { id: r.openIn } }
                  : { pathname: agentOf(r) === 'codex' ? '/codex/[sid]' : '/claude/[sid]', params: { sid: r.sessionId } },
              )
            }
            s={s}
          />
        )}
      </ScrollView>
    </>
  );
}

function Projects({ busy, onPick, s }: { busy: boolean; onPick: (cwd: string, name: string) => void; s: S }) {
  const { c } = useTheme();
  const { error, found, box, type, chosen } = useProjectSearch(api);
  const [name, setName] = useState('');
  const field = useRef<TextInput>(null);
  return (
    <>
      <TextInput
        style={s.field}
        value={name}
        onChangeText={setName}
        accessibilityLabel={t.nameOptional}
        placeholder={t.nameOptionalHint}
        placeholderTextColor={c.muted}
      />
      <View style={s.pathRow}>
        <TextInput
          ref={field}
          style={[s.field, s.grow]}
          value={box}
          onChangeText={type}
          accessibilityLabel={t.findProject}
          placeholder={t.findProject}
          placeholderTextColor={c.muted}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="go"
          onSubmitEditing={() => chosen && !busy && onPick(chosen, name)}
        />
        <Button small label={t.open} disabled={busy || !chosen} onPress={() => chosen && onPick(chosen, name)} />
      </View>
      {found.path ? !!found.error && <Text style={s.alert}>{found.error}</Text> : !!error && <Text style={s.alert}>{error}</Text>}
      {!found.rows && !(error && !found.path) && <Text style={s.muted}>{t.loading}</Text>}
      {found.rows?.length === 0 && <Text style={s.note}>{found.path ? t.noFolders : found.text ? t.notFound(found.text) : t.noProjects}</Text>}
      {found.rows?.map((dir) => {
        const folder = dir.split('/').pop() || dir;
        const option = <Option icon="folder" title={folder} sub={shortPath(dir)} disabled={busy} onPress={() => onPick(dir, name)} s={s} />;
        if (!found.path) return <View key={dir}>{option}</View>;
        return (
          <View key={dir} style={s.optionRow}>
            <View style={s.grow}>{option}</View>
            <Pressable
              style={({ pressed }) => [s.inside, pressed && s.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t.lookInside(folder)}
              onPress={() => {
                type(into(found.text, dir));
                field.current?.focus();
              }}
            >
              <SymbolView name="chevron.right" tintColor={c.muted} size={18} weight="semibold" />
            </Pressable>
          </View>
        );
      })}
    </>
  );
}

function Recent({ busy, onPick, s }: { busy: boolean; onPick: (r: RecentConversation) => void; s: S }) {
  const { c } = useTheme();
  const { data, error } = useFetched(loadRecent);
  const [q, setQ] = useState('');
  const [unfolded, setUnfolded] = useState(false);
  const { people, programs } = useMemo(() => recentFound(data ?? [], q), [data, q]);
  // What agents started stays folded away, unless a search is looking for it.
  const searching = q.trim() !== '';
  const row = (r: RecentConversation) => (
    <Option
      key={r.sessionId}
      title={r.title}
      sub={`${recentNote(r)}${timeAgo(r.lastActivity)} · ${shortPath(r.cwd ?? '')}`}
      disabled={busy || !canPickUp(r)}
      onPress={() => onPick(r)}
      s={s}
    />
  );
  return (
    <>
      <TextInput
        style={s.field}
        value={q}
        onChangeText={setQ}
        placeholder={t.searchTitlePath}
        placeholderTextColor={c.muted}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        clearButtonMode="while-editing"
      />
      {error && <Text style={s.alert}>{error}</Text>}
      {!data && !error && <Text style={s.muted}>{t.loading}</Text>}
      {data && people.length + programs.length === 0 && <Text style={s.note}>{searching ? t.noMatch : t.noConversations}</Text>}
      {people.map(row)}
      {programs.length > 0 && !searching && (
        <Pressable style={s.fold} accessibilityRole="button" accessibilityState={{ expanded: unfolded }} onPress={() => setUnfolded(!unfolded)}>
          <SymbolView name={unfolded ? 'chevron.down' : 'chevron.right'} tintColor={c.muted} size={14} />
          <Text style={s.foldText}>{t.automated(programs.length)}</Text>
        </Pressable>
      )}
      {(searching || unfolded) && programs.map(row)}
    </>
  );
}

const styles = ({ c, fs }: Theme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, gap: 10 },
    option: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    pressed: { backgroundColor: c.surface2 },
    dim: { opacity: 0.5 },
    optionText: { flex: 1, gap: 3 },
    optionTitle: { fontSize: fs(16), fontWeight: '600', color: c.text },
    optionSub: { fontSize: fs(13), color: c.muted },
    field: { minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, color: c.text, fontSize: Math.max(16, fs(16)) },
    pathRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    optionRow: { flexDirection: 'row', gap: 8 },
    inside: { width: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    grow: { flex: 1 },
    alert: { color: c.danger, fontSize: fs(14) },
    muted: { color: c.muted, fontSize: fs(15), textAlign: 'center', paddingVertical: 20 },
    note: { color: c.muted, fontSize: fs(14), textAlign: 'center', paddingVertical: 12 },
    fold: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 4 },
    foldText: { fontSize: fs(14), color: c.muted },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: 4 },
  });
