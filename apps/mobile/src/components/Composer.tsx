import { describe, type SlashCommand } from '@workoffdesk/client/composer/slash';
import { t } from '@workoffdesk/i18n';
import { SymbolView } from 'expo-symbols';
import { useMemo, useRef, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme';
import { Viewer } from './turn/media';
import { useVoice } from './composer/voice';
import { useAttachments } from './composer/attachments';
import { useSending } from './composer/sending';
import { VoicePanel } from './composer/VoicePanel';
import { styles } from './composer/styles';

// What is typed to the session. onSend says whether it went; what did not stays in the box. A refill puts
// text back above what is there (a message that could not go, one taken back, a suggestion). A `/` at the
// start offers the session's commands and an `@` its files; pictures wait above the text and go with it as
// their paths on the Mac. Holding the empty box talks: letting go sends what was heard, or it is slid onto
// Cancel to drop it or onto To text to look it over in the box first; a tap types.
export function Composer(props: {
  draftKey: string;
  onSend: (text: string) => boolean;
  onError: (message: string) => void;
  refill: { text: string; n: number } | null;
  onStop?: () => void;
  // The commands Claude takes after a `/` here, asked for the first time one is typed.
  loadCommands?: () => Promise<SlashCommand[]>;
  // The files of the session's folder an `@` can name, asked for when one is typed.
  loadFiles?: () => Promise<string[]>;
  // Shown under the input, inside the composer.
  footer?: ReactNode;
  // The key bar above the composer, which a button here shows and hides.
  keys?: { shown: boolean; onToggle: () => void };
}) {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const { c } = theme;
  const { onError } = props;
  const field = useRef<TextInput>(null);
  const { composer, box, send, name } = useSending(props, field);
  const { pictures, viewing, setViewing, opens, open, fromLibrary, fromFiles, fromCamera, pictureButton, menuAt, setMenuAt, windowHeight, choose, pickFrom, openPicked } = useAttachments(composer, box, onError);
  const source = (icon: ComponentProps<typeof SymbolView>['name'], label: string, from: () => Promise<void>) => (
    <Pressable style={({ pressed }) => [s.source, pressed && s.sourcePressed]} accessibilityRole="menuitem" onPress={() => pickFrom(from)}>
      <SymbolView name={icon} tintColor={c.text} size={20} />
      <Text style={s.sourceText}>{label}</Text>
    </Pressable>
  );

  const { at, wrap, onPressIn, onMove, onLetGo, measure, fieldTouches } = useVoice(composer, field, !!box.hold);

  const showBar = !box.text && !box.focused;
  return (
    <View style={s.wrap} ref={wrap}>
      {box.said.length + box.offered.length + box.mentioned.length > 0 && (
        <ScrollView style={s.menu} keyboardShouldPersistTaps="always" accessibilityLabel={box.mentioned.length ? t.files : t.commands}>
          {box.said.map((line) => (
            <Pressable
              key={`said-${line}`}
              style={({ pressed }) => [s.option, pressed && s.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t.snippet(line)}
              onPress={() => composer.pickSnippet(line)}
            >
              <Text style={s.snippet}>{line}</Text>
              <Text style={s.optionSub}>{t.snippets}</Text>
            </Pressable>
          ))}
          {box.offered.map((cmd) => (
            <Pressable
              key={cmd.name}
              style={({ pressed }) => [s.option, pressed && s.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`/${cmd.name} ${describe(cmd)}`}
              onPress={() => composer.pickCommand(cmd)}
            >
              <Text style={s.optionName}>/{cmd.name}</Text>
              <Text style={s.optionSub} numberOfLines={1}>
                {describe(cmd)}
              </Text>
            </Pressable>
          ))}
          {box.mentioned.map((path) => {
            const cut = path.lastIndexOf('/') + 1;
            return (
              <Pressable key={path} style={({ pressed }) => [s.option, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={`@${path}`} onPress={() => name(path)}>
                <Text style={s.optionName}>{path.slice(cut)}</Text>
                {cut > 0 && (
                  <Text style={s.optionSub} numberOfLines={1}>
                    {path.slice(0, cut)}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <View style={s.composer}>
        {box.attached.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pictures} keyboardShouldPersistTaps="always">
            {box.attached.map((p) => (
              <View key={p.key} style={p.kind === 'file' ? s.fileTile : s.picture}>
                {p.kind === 'file' ? (
                  <>
                    <SymbolView name="doc" tintColor={c.muted} size={22} />
                    <View style={s.fileText}>
                      <Text style={s.fileName} numberOfLines={2} ellipsizeMode="middle">
                        {p.name}
                      </Text>
                      {p.piece === null && <Text style={s.fileSent}>{`${t.uploading} ${Math.round((p.sent ?? 0) * 100)}%`}</Text>}
                    </View>
                  </>
                ) : p.source ? (
                  <Image source={p.source} style={s.thumb} />
                ) : (
                  <View style={[s.thumb, s.videoBlank]} />
                )}
                {p.kind === 'picture' && p.piece === null && (
                  <View style={s.thumbCover}>
                    <ActivityIndicator color="#fff" accessibilityLabel={t.uploading} />
                  </View>
                )}
                {p.kind === 'video' && (
                  <View style={s.thumbCover} accessible accessibilityLabel={p.piece === null ? `${p.name}, ${t.uploading}` : p.name}>
                    {p.piece === null ? (
                      <Text style={s.videoSent}>{`${Math.round((p.sent ?? 0) * 100)}%`}</Text>
                    ) : (
                      <SymbolView name="play.fill" tintColor="#fff" size={18} />
                    )}
                  </View>
                )}
                {opens(p) && (
                  <Pressable
                    style={StyleSheet.absoluteFill}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={p.kind === 'video' ? t.playVideo(p.name) : t.viewImage}
                    onPress={() => open(p)}
                  />
                )}
                <Pressable
                  style={s.remove}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={p.kind === 'picture' ? t.removeImage : t.removeFile}
                  onPress={() => composer.remove(p.key)}
                >
                  <SymbolView name="xmark.circle.fill" tintColor={c.muted} size={22} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
        {viewing !== null && pictures[viewing] && (
          <Viewer
            sources={pictures.map((p) => p.source)}
            paths={pictures.map((p) => p.name)}
            read={false}
            start={viewing}
            onClose={() => setViewing(null)}
          />
        )}
        <View style={s.row}>
          <Pressable
            ref={pictureButton}
            style={s.tool}
            accessibilityRole="button"
            accessibilityLabel={t.attach}
            onPress={choose}
          >
            <SymbolView name="plus" tintColor={c.muted} size={22} />
          </Pressable>
          <View style={s.field} {...fieldTouches(() => box.speech && box.focused && !box.text)}>
            {/* Each message sent makes a new input: iOS keeps an unfocused multiline input as tall as it was
                once emptied, until the keyboard comes up again. */}
            <TextInput
              key={box.sent}
              ref={field}
              style={s.input}
              value={box.text}
              onChangeText={(text) => composer.type(text)}
              onSelectionChange={(e) => composer.setCaret(e.nativeEvent.selection.end)}
              onFocus={() => composer.focus()}
              onBlur={() => composer.blur()}
              placeholder={showBar ? '' : box.speech ? t.placeholderSpeech : t.placeholder}
              placeholderTextColor={c.muted}
              accessibilityLabel={t.input}
              testID="composer"
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              // Return sends, as on the web; the input method's own confirm key does not.
              returnKeyType="send"
              submitBehavior="submit"
              onSubmitEditing={send}
            />
            {showBar && (
              <View
                style={s.holdBar}
                accessible
                accessibilityRole="button"
                accessibilityLabel={t.input}
                accessibilityHint={box.speech ? t.holdToTalk : undefined}
                testID="hold-to-talk"
                onStartShouldSetResponder={() => true}
                onResponderGrant={box.speech ? onPressIn : undefined}
                onResponderMove={onMove}
                onResponderRelease={onLetGo}
                onResponderTerminationRequest={() => false}
                onResponderTerminate={() => onLetGo(null)}
              >
                <Text style={s.holdText} numberOfLines={1}>
                  {box.speech ? t.placeholderSpeech : t.placeholder}
                </Text>
              </View>
            )}
          </View>
          {props.onStop && box.empty ? (
            <Pressable style={s.send} accessibilityRole="button" accessibilityLabel={t.stop} onPress={props.onStop}>
              <View style={[s.sendDot, s.stopDot]}>
                <View style={s.stopSquare} />
              </View>
            </Pressable>
          ) : (
            !box.empty && (
              // Sent while something uploads, it turns until that is up and it goes.
              <Pressable style={s.send} accessibilityRole="button" accessibilityLabel={box.sending ? t.sending : t.send} onPress={send} disabled={box.sending}>
                <View style={s.sendDot}>
                  {box.sending ? (
                    <ActivityIndicator color={c.accentText} />
                  ) : (
                    <SymbolView name="arrow.up" tintColor={c.accentText} size={20} weight="semibold" />
                  )}
                </View>
              </Pressable>
            )
          )}
        </View>
        {(props.footer || props.keys) && (
          <View style={s.foot}>
            <View style={s.footMain}>{props.footer}</View>
            {props.keys && (
              <Pressable
                style={[s.keysToggle, props.keys.shown && s.keysShown]}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={props.keys.shown ? t.hideKeys : t.showKeys}
                accessibilityState={{ selected: props.keys.shown }}
                onPress={props.keys.onToggle}
              >
                <SymbolView name="keyboard" tintColor={props.keys.shown ? c.accent : c.text} size={theme.fs(22)} />
              </Pressable>
            )}
          </View>
        )}
      </View>
      {box.hold && <VoicePanel hold={box.hold} at={at} measure={measure} s={s} />}
      <Modal visible={!!menuAt} transparent animationType="fade" onRequestClose={() => setMenuAt(null)} onDismiss={openPicked}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t.cancel} onPress={() => setMenuAt(null)} />
        {menuAt && (
          <View style={[s.sources, { left: menuAt.x, bottom: windowHeight - menuAt.y + 6 }]} accessibilityRole="menu">
            {source('photo.on.rectangle', t.photosAndVideos, fromLibrary)}
            {source('camera', t.takePhoto, fromCamera)}
            {source('doc', t.pickFile, fromFiles)}
          </View>
        )}
      </Modal>
    </View>
  );
}
