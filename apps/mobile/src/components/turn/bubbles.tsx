import { UITextView } from '@bsky.app/react-native-uitextview';
import { clock } from '@workoffdesk/client/model/format';
import { replyImages, splitMine } from '@workoffdesk/client/chat/images';
import { linkSpans, renderedText } from '@workoffdesk/client/chat/markdownBlocks';
import { speechLocale, t } from '@workoffdesk/i18n';
import * as Speech from 'expo-speech';
import { useContext, useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Markdown } from '../Markdown';
import { type S, useStyles } from './styles';
import { Action, JumpContext, useCopy } from './common';
import { Files, Pictures, Videos } from './media';

// Past this a message is shown cut short, to be opened: a long paste would push the reply off the screen.
const FOLD_LINES = 12;

const FOLD_CHARS = 600;

const FOLDED_LINES = 8;

// A message on its way or just sent, before the transcript has it: its pictures as pictures, as in Mine.
export function SentBubble({ sessionId, text, held }: { sessionId: string; text: string; held?: boolean }) {
  const { images, files, text: words } = splitMine(text);
  return (
    <>
      <Pictures sessionId={sessionId} paths={images} mine />
      <Videos files={files} />
      <Files files={files} />
      {!!words && <MineBubble text={words} held={held} />}
    </>
  );
}

export function MineBubble({ text, held }: { text: string; held?: boolean }) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const long = text.split('\n').length > FOLD_LINES || text.length > FOLD_CHARS;
  return (
    <>
      <View style={[s.bubble, held && s.held]}>
        <UITextView selectable uiTextView style={s.bubbleText} numberOfLines={long && !open ? FOLDED_LINES : undefined}>
          {linkSpans(text).map((sp, i) =>
            sp.href ? (
              <UITextView key={i} style={s.bubbleLink} onPress={() => void Linking.openURL(sp.href!).catch(() => {})}>
                {sp.text}
              </UITextView>
            ) : (
              sp.text
            ),
          )}
        </UITextView>
      </View>
      {long && (
        <Text style={s.more} onPress={() => setOpen(!open)} accessibilityRole="button">
          {open ? t.collapse : t.expandAll}
        </Text>
      )}
    </>
  );
}

// What was sent from the phone: its pictures as pictures, not as the paths and markers Claude was given,
// and when it was sent. onRewind: offered under the last message sent, with Copy, to open Claude Code's own
// list of points to go back to.
export function Mine({ sessionId, text, at, onRewind }: { sessionId: string; text: string; at?: string; onRewind?: () => void }) {
  const s = useStyles();
  const { images, files, text: words, unseen } = splitMine(text);
  const time = clock(at);
  const { copied, copy } = useCopy();
  return (
    <View style={s.mine}>
      <Pictures sessionId={sessionId} paths={images} mine />
      <Videos files={files} />
      <Files files={files} />
      {!!words && <MineBubble text={words} />}
      {unseen > 0 && <Text style={s.small}>{t.unseenImages(unseen)}</Text>}
      {(onRewind || !!time) && (
        <View style={s.actions}>
          {onRewind && !!words && <Action label={copied ? t.copied : t.copy} onPress={() => copy(words)} s={s} />}
          {onRewind && <Action label={t.rewind} onPress={onRewind} s={s} />}
          {!!time && <Text style={s.small}>{time}</Text>}
        </View>
      )}
    </View>
  );
}

// Under the end of a reply: copy what Claude said, or have the phone read it out. What this reply is
// reading out stops with it, when the chat it is in goes away.
function ReplyActions({ text, s }: { text: string; s: S }) {
  const { copied, copy } = useCopy();
  const [reading, setReading] = useState(false);
  const speaking = useRef(false);
  useEffect(
    () => () => {
      if (speaking.current) void Speech.stop();
    },
    [],
  );
  const read = () => {
    void Speech.stop();
    if (reading) return setReading(false);
    const over = () => {
      speaking.current = false;
      setReading(false);
    };
    speaking.current = true;
    setReading(true);
    Speech.speak(renderedText(text), { language: speechLocale, onDone: over, onStopped: over, onError: over });
  };
  return (
    <View style={s.actions}>
      <Action label={copied ? t.copied : t.copy} onPress={() => copy(text)} s={s} />
      <Action label={reading ? t.stopReading : t.readAloud} onPress={read} s={s} />
    </View>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

// A reply with the images on this Mac it names under it, unless the chat shows them already, and web images
// only as links to them. last: it ends a reply, which gets the reply's actions.
export function Reply({ sessionId, text, repeated, last }: { sessionId: string; text: string; repeated?: Set<string>; last?: boolean }) {
  const s = useStyles();
  const { text: words, local, remote } = replyImages(text);
  return (
    <>
      <View style={s.reply}>
        <Markdown text={words} />
      </View>
      {last && <ReplyActions text={words} s={s} />}
      <Pictures sessionId={sessionId} paths={local.filter((p) => !repeated?.has(p))} />
      {remote.length > 0 && (
        <View style={s.webImages}>
          {remote.map((url) => (
            <Text key={url} style={s.webImage} accessibilityRole="link" onPress={() => void Linking.openURL(url).catch(() => {})}>
              {t.webImage} · {hostOf(url)}
            </Text>
          ))}
        </View>
      )}
    </>
  );
}

// A picture the chat already shows further up: a way back to it instead of a second copy.
export function ShownAbove({ path, s }: { path: string; s: S }) {
  const { showImage } = useContext(JumpContext);
  return (
    <Text style={[s.action, s.shownAbove]} accessibilityRole="button" onPress={() => showImage(path)}>
      {t.seeImageAbove}
    </Text>
  );
}
