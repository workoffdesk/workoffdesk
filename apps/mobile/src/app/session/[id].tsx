import { agentName, isAgent } from '@workoffdesk/client/base/api';
import { chatEntries } from '@workoffdesk/client/chat/chatEntries';
import { shortPath } from '@workoffdesk/client/model/format';
import { canMoveAccount, limitStopped } from '@workoffdesk/client/sessions/moveAccount';
import { canGoOn } from '@workoffdesk/client/sessions/newSession';
import { t } from '@workoffdesk/i18n';
import { useKeyboardScrollToEnd } from '@legendapp/list/keyboard';
import type { LegendListRef } from '@legendapp/list/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, Text, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AgentName } from '@workoffdesk/react/agentName';
import { useAccountMove } from '@workoffdesk/react/moveAccount';
import { answers, api, journals, keyBar } from '../../client';
import { ChatList, type Entry } from '../../components/ChatList';
import { ChatSkeleton, PillSkeleton } from '../../components/ChatSkeleton';
import { CompactingBar, OnMacBar, SendHeld } from '../../components/cards/bars';
import { LimitActions, MoveAccountSheet } from '../../components/MoveAccount';
import { Popup } from '../../components/Popup';
import { Composer } from '../../components/Composer';
import { KeyBar, QueueTray, ScreenSheet, TaskBar } from '../../components/Footer';
import { RenameSheet } from '../../components/RenameSheet';
import { SessionPill } from '../../components/SessionPill';
import { JumpContext } from '../../components/turn/common';
import { Button, statusLook } from '../../components/ui';
import { useNow } from '@workoffdesk/react/clock';
import { useSession } from '../../store';
import { useTheme } from '../../theme';
import { PageHeader } from '../../components/header';
import { dialogOn, entryNode } from '../../components/session/entries';
import { useJump } from '../../components/session/jump';
import { useSessionMenu } from '../../components/session/menu';
import { Overlay, SyncDots } from '../../components/session/parts';
import { styles } from '../../components/session/styles';

// A session as the phone has it: Claude's conversation, and a way to type to it. A session that is not
// Claude's (one opened on the Mac) is only named here; its screen can be looked at as text.
export default function SessionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SessionScreen key={id} id={id} />;
}

function SessionScreen({ id }: { id: string }) {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const [session, ss] = useSession(id);
  const { known, kind, ended, status, view, link } = ss;
  const agent = isAgent(kind) ? kind : null;
  const who = agentName(kind);
  const chatShown = !!agent;

  const [keysShown, setKeysShown] = useState(keyBar.shown);
  const toggleKeys = () => {
    keyBar.show(!keysShown);
    setKeysShown(!keysShown);
  };
  const { move, ...moveState } = useAccountMove(api, id, known?.claudeAccount, (text) => void session.sendMessage(text));
  const switchAccount = canMoveAccount(kind, moveState) ? () => move.offer(null) : undefined;
  const { screenShown, setScreenShown, renaming, setRenaming, goingOn, actions, startAnother, goOn, onScreen } = useSessionMenu(id, session, ss, switchAccount);
  // Scrolled up from the end: what comes in then is added below without moving what is being read.
  const [away, setAway] = useState(false);
  const list = useRef<LegendListRef>(null);
  // What is under the chat, floating on the keyboard: the list keeps its last row clear of it.
  const dock = useRef<View>(null);
  const [docked, setDocked] = useState(0);
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef: list });
  // The dock sits on the keyboard 8pt up, not the home indicator's height.
  const keyboardOffset = Math.max(insets.bottom, 8) - 8;

  const { screen } = view;
  const headerSays = ss.header;
  const look = headerSays && (headerSays === 'reconnecting' ? { color: null, label: t.reconnecting } : statusLook(theme.c, headerSays));
  const { panel } = screen;
  const queued = ss.queued;
  const send = session.send;
  const press = session.press;
  const reread = session.reread;
  const settle = session.settle;
  // A message sent from here takes the reader back to the end, wherever they were reading.
  const newest = view.messages.findLast((m) => m.state === 'sending')?.id;
  useEffect(() => {
    if (newest) void scrollMessageToEnd({ animated: true, closeKeyboard: false });
  }, [newest, scrollMessageToEnd]);

  const kept = view.items.length > 0 || view.messages.length > 0;
  // What the phone holds may be behind until the Mac answers.
  const syncing = !view.synced && !view.failed && !ended;

  const dialogUp = !!ss.dialog;
  const { entries: rowsOf, shown, inEntry } = useMemo(
    () => chatEntries({ kind, view, status, answers: answers.answersOf(id), queued: queued.length, dialog: dialogUp }),
    [kind, view, status, id, queued.length, dialogUp],
  );
  const now = useNow(status === 'working');
  const limitActions = <LimitActions move={move} state={moveState} />;
  // A message typed while the chat is stopped on its account's limit asks first whether to go on on another.
  const sendMessage = (text: string) => {
    const offer = canMoveAccount(kind, moveState) && !text.startsWith('/');
    if (offer && limitStopped({ view, status, queued: queued.length })) {
      move.offer(text, true);
      return true;
    }
    return session.sendMessage(text);
  };
  const entries: Entry[] = rowsOf.map((e) => ({ key: e.key, node: entryNode(e, { id, s, theme, who, now, limitActions, send, press, reread, onScreen }) }));
  const dialog = ss.dialog && dialogOn(ss.dialog, { id, press, onScreen, settle });

  const jump = useJump(list, entries, inEntry, shown);

  return (
    <AgentName.Provider value={who}>
      <View style={s.page}>
        <PageHeader
          title={
            <Pressable
              style={s.title}
              accessibilityRole="button"
              accessibilityLabel={t.renameSession(known?.title ?? t.session)}
              disabled={!known || ended}
              onPress={() => {
                Keyboard.dismiss();
                setRenaming(true);
              }}
            >
              <Text style={s.titleText} numberOfLines={1}>
                {known?.title ?? t.session}
              </Text>
              <Text style={s.titleSub} numberOfLines={1}>
                {look && <Text style={{ color: look.color ?? theme.c.muted, fontWeight: '600' }}>{`● ${look.label}  `}</Text>}
                {shortPath(known?.cwd ?? '')}
              </Text>
            </Pressable>
          }
          right={
            // An ended session has nothing left to do to it.
            !ended && (
              <Pressable accessibilityRole="button" accessibilityLabel={t.sessionMenu} hitSlop={8} onPress={actions}>
                <SymbolView name="ellipsis" tintColor={theme.c.text} size={24} />
              </Pressable>
            )
          }
        />
        <View style={s.page}>
          {/* Focus leaves the composer on a drag or a tap the chat's rows do not take (ChatList.tsx), and on a
              tap on a message (SelectText.tsx); a card's controls keep it, as on the web. */}
          <View style={s.chat}>
            {chatShown && (!syncing || kept) && (
              // A chat kept from before shows while it is brought up to date, so the list is at its end before
              // what came since goes in.
              <JumpContext value={jump}>
                <ChatList
                  listRef={list}
                  entries={entries}
                  sentId={newest}
                  onOlder={() => void journals.older(id)}
                  loadingOlder={view.loadingOlder}
                  room={docked}
                  dock={dock}
                  freeze={freeze}
                  keyboardOffset={keyboardOffset}
                  empty={!view.synced && !view.failed && ended ? <Text style={[s.muted, s.center, s.reading]}>{t.endedNoChat}</Text> : null}
                  onAway={setAway}
                />
              </JumpContext>
            )}
            {(chatShown || kind === null) && syncing && !kept && <ChatSkeleton />}
            {kind === 'shell' && !ended && (
              <Overlay title={t.shellSession} sub={t.shellSessionSub} s={s}>
                <View style={s.actions}>
                  <Button label={t.back} onPress={() => router.back()} />
                  <Button kind="primary" label={t.showScreen} onPress={onScreen} />
                </View>
              </Overlay>
            )}
            {/* A chat is read and sent over HTTP: the line only carries keys, and the header says it is down. */}
            {link === 'reconnecting' && !ended && !agent && (
              <Overlay title={t.reconnecting} sub={t.reconnectingSub} s={s}>
                <ActivityIndicator color={theme.c.muted} />
              </Overlay>
            )}
            {ended && !agent && (
              <Overlay title={t.sessionEnded} sub={t.sessionEndedSub} s={s}>
                <View style={s.actions}>
                  <Button label={t.back} onPress={() => router.back()} />
                </View>
              </Overlay>
            )}
          </View>
          <KeyboardStickyView style={s.dock} offset={{ opened: keyboardOffset }}>
            <View ref={dock} onLayout={(e) => setDocked(e.nativeEvent.layout.height)}>
              {chatShown && away && (
                <Pressable
                  style={s.toBottom}
                  accessibilityRole="button"
                  accessibilityLabel={t.toBottom}
                  onPress={() => void scrollMessageToEnd({ animated: true, closeKeyboard: false })}
                >
                  <SymbolView name="chevron.down" tintColor={theme.c.text} size={18} weight="semibold" />
                </Pressable>
              )}
              {(ended || ss.quit) && known && agent && (
                // Where typing was, as Messages puts what can no longer be replied to: the conversation stays readable.
                <View style={[s.footer, s.endedBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
                  {ss.quit && (
                    <View style={s.endedQueue}>
                      <QueueTray queued={queued} why={ss.queueWhy} onMove={session.move} onEdit={(q) => session.unsend(q, true)} onDrop={(q) => session.unsend(q, false)} />
                    </View>
                  )}
                  <Text style={s.overlayTitle}>{ss.quit ? t.agentQuit(who) : t.sessionEnded}</Text>
                  <Text style={[s.muted, s.center]}>{ss.quit ? t.agentQuitSub : canGoOn(known) ? t.endedGoOnSub : t.sessionEndedSub}</Text>
                  {canGoOn(known) ? (
                    <View style={s.actions}>
                      <Button label={t.startAnother} disabled={goingOn} onPress={() => void startAnother(agent, known.cwd)} />
                      <Button kind="primary" label={t.continueConversation} busy={goingOn} onPress={() => goOn(agent, known)} />
                    </View>
                  ) : (
                    <View style={s.actions}>
                      <Button label={t.back} onPress={() => router.back()} />
                      <Button kind="primary" label={t.startAnother} onPress={() => void startAnother(agent, known.cwd)} />
                    </View>
                  )}
                </View>
              )}
              {kind !== 'shell' && !ended && !ss.quit && (
                <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
                  {panel && <SendHeld nudge={ss.nudge} panel={panel} onKey={press} onDone={reread} />}
                  {view.onMac > 0 && <OnMacBar terminals={view.onMac} sessionId={id} />}
                  {status === 'compacting' && <CompactingBar count={queued.length} />}
                  {chatShown && <TaskBar tasks={view.tasks} />}
                  <QueueTray
                    queued={queued}
                    why={ss.queueWhy}
                    onSendNow={ss.canSendNow ? session.sendNow : undefined}
                    onMove={session.move}
                    onEdit={(q) => session.unsend(q, true)}
                    onDrop={(q) => session.unsend(q, false)}
                  />
                  {ss.suggestion && (
                    <View style={s.suggest}>
                      <Pressable style={s.suggestTake} accessibilityRole="button" onPress={() => session.giveBack(ss.suggestion!)}>
                        <Text style={s.small}>{t.suggestion}</Text>
                        <Text style={s.suggestText} numberOfLines={2}>
                          {ss.suggestion}
                        </Text>
                      </Pressable>
                      <Button small label={t.dismissSuggestion} onPress={session.dismissSuggestion}>
                        <SymbolView name="xmark" tintColor={theme.c.muted} size={16} />
                      </Button>
                    </View>
                  )}
                  {(keysShown || ss.ctrl) && <KeyBar ctrlArmed={ss.ctrl} onCtrl={() => session.armCtrl(!ss.ctrl)} onKey={send} onPaste={() => void session.paste()} />}
                  <Composer
                    keys={{ shown: keysShown, onToggle: toggleKeys }}
                    draftKey={id}
                    onSend={sendMessage}
                    onError={session.sayToast}
                    loadCommands={chatShown ? session.loadCommands : undefined}
                    loadFiles={session.loadFiles}
                    refill={ss.refill}
                    onStop={status === 'working' ? () => send('\x1b') : undefined}
                    footer={
                      kind === null ? <PillSkeleton /> : chatShown && <SessionPill usage={known?.usage} account={known?.claudeAccount} mode={ss.mode} models={ss.models} switching={ss.switching} commanding={ss.commanding} fixed={kind === 'codex'} onCommand={session.runCommand} onMode={(m) => void session.switchMode(m)} />
                    }
                  />
                  {/* A chat kept from before shows while what came since is asked for; nothing is typed to it
                      until then. The page turns blue under the composer, as when the box is held. */}
                  {syncing && kept && (
                    <View style={s.veil} accessible accessibilityLabel={t.syncing} accessibilityLiveRegion="polite">
                      <View style={s.veilFade} />
                      <View style={[s.veilBody, { paddingBottom: Math.max(insets.bottom, 8) }]}>
                        <Text style={s.veilText}>{t.syncing}</Text>
                        <SyncDots />
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>
          </KeyboardStickyView>
          {dialog && (
            <Popup busy={ss.dialogBusy} onClose={() => session.closeDialog() && settle()}>
              {dialog}
            </Popup>
          )}
          <MoveAccountSheet move={move} state={moveState} onGiveBack={session.giveBack} />
          {ss.toast && (
            <View style={[s.toast, { top: 12 }]} pointerEvents="none" accessibilityLiveRegion="polite">
              <Text style={s.toastText}>{ss.toast}</Text>
            </View>
          )}
          {screenShown && (
            <ScreenSheet
              sessionId={id}
              onClose={() => setScreenShown(false)}
              keys={ended ? undefined : { ctrlArmed: ss.ctrl, onCtrl: () => session.armCtrl(!ss.ctrl), onKey: send, onPaste: () => void session.paste() }}
            />
          )}
          {renaming && known && <RenameSheet session={known} onClose={() => setRenaming(false)} />}
        </View>
      </View>
    </AgentName.Provider>
  );
}
