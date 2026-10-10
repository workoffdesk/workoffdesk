import { errorText, type TermSession } from '@workoffdesk/client/base/api';
import { attachCommand, createSession, goOnWith } from '@workoffdesk/client/sessions/newSession';
import { t } from '@workoffdesk/i18n';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Keyboard } from 'react-native';
import { api } from '../../client';
import type { Session, SessionSnapshot } from '@workoffdesk/client/sessions/session';

// The session's own sheets and menu: its screen, renaming it, and going on with its conversation once its
// agent quit or it ended.
export function useSessionMenu(id: string, session: Session, ss: SessionSnapshot) {
  const { known } = ss;
  const [screenShown, setScreenShown] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [goingOn, setGoingOn] = useState(false);
  const kill = async () => {
    if (await session.end()) router.back();
  };
  // The command that joins this session from a terminal on the Mac, where it goes on as the same session.
  const continueOnMac = () => {
    const command = attachCommand(id);
    Alert.alert(t.continueOnMac, `${t.continueOnMacSub}\n\n${command}`, [
      { text: t.copy, onPress: () => void Clipboard.setStringAsync(command).catch(() => {}) },
      { text: t.close, style: 'cancel' },
    ]);
  };
  // The session's own actions. Ending it is the sheet's destructive choice, which is its confirmation.
  const actions = () => {
    Keyboard.dismiss();
    const items = [
      { label: t.showScreen, run: () => setScreenShown(true), destructive: false },
      { label: t.continueOnMac, run: continueOnMac, destructive: false },
      ...(known ? [{ label: t.rename, run: () => setRenaming(true), destructive: false }] : []),
      ...(!ss.ending ? [{ label: t.endSession, run: () => void kill(), destructive: true }] : []),
    ];
    const end = items.findIndex((i) => i.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: known?.title,
        options: [...items.map((i) => i.label), t.cancel],
        cancelButtonIndex: items.length,
        destructiveButtonIndex: end < 0 ? undefined : end,
      },
      (i) => items[i]?.run(),
    );
  };
  const startAnother = (kind: 'claude' | 'codex', cwd: string) =>
    createSession(api, { kind, cwd }).then(
      (made) => router.replace({ pathname: '/session/[id]', params: { id: made.id } }),
      (e) => session.sayToast(errorText(e, t.openFailed)),
    );
  // In this session when only its agent quit; in a new one when the session is gone.
  const goOn = (kind: 'claude' | 'codex', from: TermSession) => {
    setGoingOn(true);
    goOnWith(api, { ...from, kind }, ss.quit)
      .then(
        (to) => {
          if ('onMac' in to) router.push({ pathname: to.onMac.agent === 'codex' ? '/codex/[sid]' : '/claude/[sid]', params: { sid: to.onMac.sid } });
          else if (to.session.id !== id) router.replace({ pathname: '/session/[id]', params: { id: to.session.id } });
        },
        (e) => session.sayToast(errorText(e, t.continueFailed)),
      )
      .finally(() => setGoingOn(false));
  };
  const onScreen = () => {
    Keyboard.dismiss();
    setScreenShown(true);
  };
  return { screenShown, setScreenShown, renaming, setRenaming, goingOn, actions, startAnother, goOn, onScreen };
}
