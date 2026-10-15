import { useEffect, useState } from 'react';
import { agentName, api, errorText, isAgent, MACHINE, type Agent, type TermSession } from '../api';
import { AgentName } from '@workoffdesk/react/agentName';
import { ChatView, SendHeld } from '../components/ChatView';
import { RenameSheet } from '../components/RenameSheet';
import { Composer } from '../components/Composer';
import { KeyBar } from '../components/KeyBar';
import { CompactingBar, ForegroundBar, OnMacBar } from '../components/Outbox';
import { createSession } from '../components/NewSessionSheet';
import { ScreenSheet } from '../components/ScreenSheet';
import { StatusWord } from '../components/StatusWord';
import { ActionSheet } from '../components/ActionSheet';
import { PageHeader } from '../components/PageHeader';
import { shortPath } from '@workoffdesk/client/model/format';
import { IconClose, IconMore } from '../icons';
import { navigate } from '../router';
import { keyBar } from '../platform';
import { QueueTray } from '../components/QueueTray';
import { PillSkeleton, SessionPill } from '../components/KeyMenus';
import { TaskBar } from '../components/TaskBar';
import { useSession } from '../store';
import { t } from '@workoffdesk/i18n';
import { attachCommand, canGoOn, goOnWith } from '@workoffdesk/client/sessions/newSession';
import { canMoveAccount, limitStopped } from '@workoffdesk/client/sessions/moveAccount';
import { useAccountMove } from '@workoffdesk/react/moveAccount';
import { LimitActions, MoveAccountSheet } from '../components/MoveAccount';

// The command that joins this session from a terminal on the Mac, where it goes on as the same session, in the
// alert the phone shows it in.
function ContinueOnMac({ id, onClose }: { id: string; onClose: () => void }) {
  const command = attachCommand(id);
  const copy = () => navigator.clipboard.writeText(command).catch(() => window.prompt(t.continueOnMacSub, command));
  return (
    <ActionSheet
      title={t.continueOnMac}
      message={`${t.continueOnMacSub}\n\n${command}`}
      side
      cancel={t.close}
      actions={[{ label: t.copy, run: () => void copy() }]}
      onClose={onClose}
    />
  );
}

// While something takes typing, the page is as tall as what is visible, so the key bar stays above the
// on-screen keyboard, which iOS lays over the page without resizing it. Otherwise it is the whole view:
// iOS can keep reporting the keyboard's height after the keyboard is gone, with no event to say so.
const KEYBOARD_MIN_PX = 150;
// iOS 26 can open a home-screen app in a view that stops short of the screen bottom; the home indicator
// is then in the strip iOS paints below it, not under the page.
const SHORT_VIEW_MIN_PX = 20;
function viewStopsShortOfScreen() {
  if (!window.matchMedia('(display-mode: standalone)').matches) return false;
  const portrait = window.innerHeight >= window.innerWidth;
  const screenHeight = portrait
    ? Math.max(screen.width, screen.height)
    : Math.min(screen.width, screen.height);
  return screenHeight - window.innerHeight >= SHORT_VIEW_MIN_PX;
}
const takesTyping = (el: Element | null) =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement &&
    !['button', 'checkbox', 'radio', 'range', 'submit', 'file'].includes(
      el.type
    )) ||
  (el instanceof HTMLElement && el.isContentEditable);
function useVisualViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const typing = takesTyping(document.activeElement);
      if (typing) root.style.setProperty('--vvh', `${vv.height}px`);
      else root.style.removeProperty('--vvh');
      // Nothing of the page is over the home indicator: the keyboard covers it, or the view ends above it.
      const keyboard =
        typing && vv.height < window.innerHeight - KEYBOARD_MIN_PX;
      root.toggleAttribute(
        'data-no-home-indicator',
        keyboard || viewStopsShortOfScreen()
      );
      window.scrollTo(0, 0);
    };
    // Focus moving to another field passes through nothing focused; look once it has settled.
    let frame = 0;
    const updateSoon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    document.addEventListener('focusout', updateSoon);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      document.removeEventListener('focusout', updateSoon);
      root.style.removeProperty('--vvh');
      root.removeAttribute('data-no-home-indicator');
    };
  }, []);
}

// A session as the phone has it: Claude's conversation, and a way to type to it. A session that is not
// Claude's (one opened on the Mac) is only named here; its screen can be looked at as text.
export function SessionPage({ id }: { id: string }) {
  useVisualViewportHeight();
  const [session, s] = useSession(id);
  const [keysShown, setKeysShown] = useState(keyBar.shown);
  const toggleKeys = () => {
    keyBar.show(!keysShown);
    setKeysShown(!keysShown);
  };
  const { known, kind, ended, status, header, link, view } = s;
  const { screen } = view;
  const agent = isAgent(kind) ? kind : null;
  const chat = !!agent;
  const [menuShown, setMenuShown] = useState(false);
  const [macShown, setMacShown] = useState(false);
  const [screenShown, setScreenShown] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [goingOn, setGoingOn] = useState(false);
  const { move, ...moveState } = useAccountMove(api, id, known?.claudeAccount, (text) => void session.sendMessage(text));
  // A message typed while the chat is stopped on its account's limit asks first whether to go on on another.
  const send = (text: string) => {
    const offer = canMoveAccount(kind, moveState) && !text.startsWith('/');
    if (offer && limitStopped({ view, status, queued: s.queued.length })) {
      move.offer(text, true);
      return true;
    }
    return session.sendMessage(text);
  };
  // In this session when only its agent quit; in a new one when the session is gone.
  const goOn = (kind: Agent, from: TermSession) => {
    setGoingOn(true);
    goOnWith(api, { ...from, kind }, s.quit)
      .then(
        (to) => {
          if ('onMac' in to) navigate(`/${to.onMac.agent}/${to.onMac.sid}`);
          else if (to.session.id !== id) navigate(`/m/${MACHINE}/s/${to.session.id}`);
        },
        (e) => session.sayToast(errorText(e, t.continueFailed)),
      )
      .finally(() => setGoingOn(false));
  };

  // The bytes say what a file is, whatever the phone calls it. Sent again when the line drops: one that
  // arrived twice is saved twice, and only the path answered is used.
  const raw = {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    idempotent: true,
  };
  const upload = async (file: File) =>
    (await api<{ path: string }>('/api/uploads', { ...raw, body: file })).path;

  const kill = async () => {
    if (await session.end()) navigate('/');
  };
  // The session's own actions, as the phone's sheet has them. Ending it is the sheet's red choice, which is
  // its confirmation.
  const actions = [
    { label: t.showScreen, run: () => setScreenShown(true) },
    { label: t.continueOnMac, run: () => setMacShown(true) },
    ...(canMoveAccount(kind, moveState) ? [{ label: t.switchAccount, run: () => move.offer(null) }] : []),
    ...(known ? [{ label: t.rename, run: () => setRenaming(true) }] : []),
    ...(!s.ending ? [{ label: t.endSession, run: () => void kill(), destructive: true }] : []),
  ];
  return (
    <AgentName.Provider value={agentName(kind)}>
      <div className="term-page" data-link={link}>
        <PageHeader
          onBack={() => navigate('/')}
          title={
            <button
              className="term-title"
              aria-label={t.renameSession(known?.title ?? t.session)}
              disabled={!known || ended}
              onClick={() => setRenaming(true)}
            >
              <strong>{known?.title ?? t.session}</strong>
              <span>
                {header && <StatusWord s={header} />}
                {shortPath(known?.cwd ?? '')}
              </span>
            </button>
          }
          right={
            // An ended session has nothing left to do to it.
            !ended && (
              <button className="icon-btn" aria-label={t.sessionMenu} onClick={() => setMenuShown(true)}>
                <IconMore />
              </button>
            )
          }
        />
        <div className="term-wrap">
          {chat && (
            <ChatView session={session} s={s} limitActions={<LimitActions move={move} state={moveState} />} />
          )}
          {kind === 'shell' && !ended && (
            <div className="overlay">
              <strong>{t.shellSession}</strong>
              <span className="muted">
                {t.shellSessionSub}
              </span>
              <div className="actions">
                <button className="btn" onClick={() => navigate('/')}>
                  {t.back}
                </button>
                <button
                  className="btn primary"
                  onClick={() => setScreenShown(true)}
                >
                  {t.showScreen}
                </button>
              </div>
            </div>
          )}
          {/* A chat is read and sent over HTTP: the line only carries keys, and the header says it is down. */}
          {link === 'reconnecting' && !ended && !agent && (
            <div className="overlay">
              <div className="spinner" />
              <strong>{t.reconnecting}</strong>
              <span className="muted">
                {t.reconnectingSub}
              </span>
            </div>
          )}
          {ended && !agent && (
            <div className="overlay">
              <strong>{t.sessionEnded}</strong>
              <span className="muted">{t.sessionEndedSub}</span>
              <div className="actions">
                <button className="btn" onClick={() => navigate('/')}>
                  {t.back}
                </button>
              </div>
            </div>
          )}
        </div>
        {(ended || s.quit) && known && agent && (
          // Where typing was, as Messages puts what can no longer be replied to: the conversation stays readable.
          <footer className="term-bottom ended-bar">
            {s.quit && (
              <QueueTray
                queued={s.queued}
                why={s.queueWhy}
                onMove={(q, by) => void session.move(q, by)}
                onEdit={(q) => void session.unsend(q, true)}
                onDrop={(q) => void session.unsend(q, false)}
              />
            )}
            <strong>{s.quit ? t.agentQuit(agentName(agent)) : t.sessionEnded}</strong>
            <span className="muted">{s.quit ? t.agentQuitSub : canGoOn(known) ? t.endedGoOnSub : t.sessionEndedSub}</span>
            {canGoOn(known) ? (
              <div className="actions">
                <button className="btn" disabled={goingOn} onClick={() => void createSession({ kind: agent, cwd: known.cwd })}>
                  {t.startAnother}
                </button>
                <button className="btn primary" disabled={goingOn} onClick={() => goOn(agent, known)}>
                  {t.continueConversation}
                </button>
              </div>
            ) : (
              <div className="actions">
                <button className="btn" onClick={() => navigate('/')}>
                  {t.back}
                </button>
                <button className="btn primary" onClick={() => void createSession({ kind: agent, cwd: known.cwd })}>
                  {t.startAnother}
                </button>
              </div>
            )}
          </footer>
        )}
        {kind !== 'shell' && !ended && !s.quit && (
          <footer className="term-bottom">
            {screen.panel && (
              <SendHeld
                panel={screen.panel}
                nudge={s.nudge}
                onKey={session.press}
                onDone={session.reread}
              />
            )}
            {view.onMac > 0 && <OnMacBar terminals={view.onMac} sessionId={id} onError={session.sayToast} />}
            {status === 'compacting' && (
              <CompactingBar count={s.queued.length} />
            )}
            {chat && <TaskBar tasks={view.tasks} />}
            {s.canBackground && <ForegroundBar call={s.foreground} busy={s.backgrounding} onBackground={session.toBackground} />}
            <QueueTray
              queued={s.queued}
              why={s.queueWhy}
              onSendNow={s.canSendNow ? (q) => void session.sendNow(q) : undefined}
              onMove={(q, by) => void session.move(q, by)}
              onEdit={(q) => void session.unsend(q, true)}
              onDrop={(q) => void session.unsend(q, false)}
            />
            {s.suggestion && (
              <div className="suggest">
                <button className="suggest-take" onClick={() => session.giveBack(s.suggestion!)}>
                  <small>{t.suggestion}</small>
                  <span>{s.suggestion}</span>
                </button>
                <button className="icon-btn" aria-label={t.dismissSuggestion} onClick={session.dismissSuggestion}>
                  <IconClose />
                </button>
              </div>
            )}
            {(keysShown || s.ctrl) && (
              <KeyBar
                ctrlArmed={s.ctrl}
                onCtrl={() => session.armCtrl(!s.ctrl)}
                onKey={session.send}
                onPaste={() => void session.paste()}
              />
            )}
            <Composer
              draftKey={id}
              keys={{ shown: keysShown, onToggle: toggleKeys }}
              onSend={send}
              onUpload={upload}
              onError={session.sayToast}
              loadCommands={session.loadCommands}
              loadFiles={session.loadFiles}
              refill={s.refill}
              onStop={status === 'working' ? () => session.send('\x1b') : undefined}
              footer={
                kind === null ? (
                  <PillSkeleton />
                ) : (
                  chat && (
                    <SessionPill
                      usage={known?.usage}
                      account={known?.claudeAccount}
                      mode={s.mode}
                      models={s.models}
                      switching={s.switching}
                      fixed={kind === 'codex'}
                      onCommand={session.runCommand}
                      onMode={(m) => void session.switchMode(m)}
                    />
                  )
                )
              }
            />
          </footer>
        )}
        {s.toast && <div className="toast">{s.toast}</div>}
        {renaming && known && (
          <RenameSheet session={known} onClose={() => setRenaming(false)} onFailed={session.sayToast} />
        )}
        {screenShown && (
          <ScreenSheet
            sessionId={id}
            onClose={() => setScreenShown(false)}
            keys={ended ? undefined : { ctrlArmed: s.ctrl, onCtrl: () => session.armCtrl(!s.ctrl), onKey: session.send, onPaste: () => void session.paste() }}
          />
        )}
        {menuShown && <ActionSheet title={known?.title} actions={actions} onClose={() => setMenuShown(false)} />}
        {macShown && <ContinueOnMac id={id} onClose={() => setMacShown(false)} />}
        <MoveAccountSheet move={move} state={moveState} onGiveBack={session.giveBack} />
      </div>
    </AgentName.Provider>
  );
}
