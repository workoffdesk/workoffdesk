import { t } from '@workoffdesk/i18n';
import * as Clipboard from 'expo-clipboard';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { type S } from './styles';
import { SHOWN_LINES } from './tools';

const COPIED_MS = 1500;

// What a tap elsewhere in the chat asks to be shown: a tool call opened where it is (a file in the changes
// card), or a picture where it first appears; `n` changes with each ask, so the same one can be asked again.
export type Jump = {
  opened: { key: string; n: number } | null;
  openTool: (id: string) => void;
  showImage: (path: string) => void;
};

export const JumpContext = createContext<Jump>({ opened: null, openTool: () => {}, showImage: () => {} });

// Open, and opened again whenever the chat is asked to show `key` (or, for a row of calls, one of `keys`),
// also when the row first appears because of that ask (a call inside a row of calls the ask opened).
export function useOpened(keys: string[]) {
  const { opened } = useContext(JumpContext);
  const [open, setOpen] = useState(() => !!opened && keys.includes(opened.key));
  const [seen, setSeen] = useState(opened);
  if (opened !== seen) {
    setSeen(opened);
    if (opened && keys.includes(opened.key)) setOpen(true);
  }
  return [open, setOpen] as const;
}

// Copied for a moment after a tap.
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) =>
    void Clipboard.setStringAsync(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  return { copied, copy };
}

export function Action({ label, onPress, s }: { label: string; onPress: () => void; s: S }) {
  return (
    <Text style={s.action} onPress={onPress} accessibilityRole="button" suppressHighlighting={false}>
      {label}
    </Text>
  );
}

// The first lines in place; with more, a way to all of them in a sheet that scrolls.
export function LongView({ count, style, s, all, children }: { count: number; style: object; s: S; all: () => ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <View style={style}>{children}</View>
      {count > SHOWN_LINES && (
        <Text style={s.allLines} onPress={() => setOpen(true)} accessibilityRole="button">
          {t.allLines(count)}
        </Text>
      )}
      {open && (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>{t.allLines(count)}</Text>
              <Text style={s.sheetClose} onPress={() => setOpen(false)} accessibilityRole="button">
                {t.close}
              </Text>
            </View>
            <ScrollView contentContainerStyle={s.sheetBody}>{all()}</ScrollView>
          </View>
        </Modal>
      )}
    </>
  );
}
