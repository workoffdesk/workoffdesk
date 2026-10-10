import { coverUrl, uploadUrl } from '@workoffdesk/client/chat/images';
import type { SlashCommand } from '@workoffdesk/client/composer/slash';
import { createComposer } from '@workoffdesk/client/composer/composer';
import { speechErrorText } from '@workoffdesk/client/composer/talk';
import { t } from '@workoffdesk/i18n';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Alert, Linking, TextInput } from 'react-native';
import { auth, drafts, signIn, snippets } from '../../client';
import { recognize } from '../../speech';
import { useStore } from '../../store';

// How the phone shows a picture: from itself, or from the Mac with the login.
export type Source = { uri: string; headers?: Record<string, string> };

// An image on the Mac, fetched with the login.
export const fromMac = (url: string) => ({ uri: (auth.current()?.server ?? '') + url, headers: signIn() });

// What iOS was refused, with the way to Settings, where only the user can allow it.
export const refused = (message: string) =>
  Alert.alert(message, undefined, [
    { text: t.cancel, style: 'cancel' },
    { text: t.openSettings, onPress: () => void Linking.openSettings() },
  ]);

// The composer's store, made once and fed the props as they change, and sending from it: the keyboard goes
// away so the answer can be read, and a file named after an `@` puts the cursor after it.
export function useSending(
  props: { draftKey: string; onSend: (text: string) => boolean; onError: (message: string) => void; refill: { text: string; n: number } | null; loadCommands?: () => Promise<SlashCommand[]>; loadFiles?: () => Promise<string[]> },
  field: RefObject<TextInput | null>,
) {
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  // The store keeps these callbacks for events; it calls none of them while it is made.
  // eslint-disable-next-line react-hooks/refs
  const [composer] = useState(() =>
    createComposer<Source>({
      draftKey: props.draftKey,
      drafts,
      snippets,
      loadCommands: props.loadCommands && (() => latest.current.loadCommands!()),
      loadFiles: props.loadFiles && (() => latest.current.loadFiles!()),
      onSend: (text) => latest.current.onSend(text),
      onError: (message) => latest.current.onError(message),
      sourceOf: (kind, path) => fromMac(kind === 'picture' ? uploadUrl(path) : coverUrl(path)),
      recognize,
      speech: true,
      speechFailed: (error) => {
        if (error === 'not-allowed') refused(t.speechDeniedApp);
        else latest.current.onError(error === 'service-not-allowed' ? t.speechOff : speechErrorText(error));
        return error === 'service-not-allowed';
      },
      focusField: () => field.current?.focus(),
      refill: props.refill,
    }),
  );
  const box = useStore(composer);
  useEffect(() => {
    composer.refill(props.refill);
  }, [composer, props.refill]);
  useEffect(() => () => composer.leave(), [composer]);

  // The keyboard goes away so the answer can be read; a tap on the box brings it back.
  const send = () => {
    if (composer.send()) field.current?.blur();
  };
  const name = (path: string) => {
    const at = composer.pickFile(path);
    if (at !== null) requestAnimationFrame(() => field.current?.setSelection(at, at));
  };
  return { composer, box, send, name };
}
