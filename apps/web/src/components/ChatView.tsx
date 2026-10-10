import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isLimit, type ChatState, type Panel, panelName } from '@workoffdesk/client/model/chat';
import { chatEntries, type ChatEntry } from '@workoffdesk/client/chat/chatEntries';
import type { ChatFeed } from '@workoffdesk/client/chat/chatFeed';
import type { Session, SessionSnapshot } from '@workoffdesk/client/sessions/session';
import { answers, chatFeeds, journals, visibility } from '../platform';
import { duration } from '@workoffdesk/client/model/format';
import { IconDown } from '../icons';
import { ChoiceCard } from './cards/ChoiceCard';
import { PermissionCard } from './cards/PermissionCard';
import { PanelCard } from './cards/PanelCard';
import { TickCard } from './cards/TickCard';
import { press } from './KeyBar';
import { OutboxBubbles } from './Outbox';
import { ScreenSheet } from './ScreenSheet';
import { BackgroundBar } from './BackgroundBar';
import { TurnView } from './TurnView';
import { Viewer } from './turn/media';
import { ToolsRow } from './turn/ToolsRow';
import { t } from '@workoffdesk/i18n';
import { useNow } from '@workoffdesk/react/clock';
import { useAgentName } from '@workoffdesk/react/agentName';

// Pixels from the bottom that still count as reading the latest.
const AT_BOTTOM_PX = 40;
// Pixels from the top at which earlier turns are asked for, so they are usually in before the top is.
const NEAR_TOP_PX = 300;

// A chat as the shared feed reads it (chatFeed.ts): as last shown here, then as kept on the phone, then
// from the Mac. sessionId: what the chat is kept under on this device; url: where it is read from.
export function useChat(sessionId: string, url: string) {
  const [chat, setChat] = useState<ChatState | null>(() => chatFeeds.remembered(sessionId));
  const [failed, setFailed] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const feed = useRef<ChatFeed | null>(null);

  useEffect(() => {
    const f = chatFeeds.follow(sessionId, url, { show: setChat, failed: setFailed, loadingOlder: setLoadingOlder }, visibility);
    feed.current = f;
    return () => {
      f.stop();
      feed.current = null;
    };
  }, [sessionId, url]);

  // beforeShow runs just before the earlier turns go in, while the page still shows it as it was.
  const loadOlder = useCallback(async (beforeShow: () => void) => feed.current?.older(beforeShow), []);

  return { chat, failed, loadingOlder, loadOlder };
}

// Above the composer while a panel holds back what is sent, wherever the chat is scrolled to. `nudge`
// changes each time a send is held, to draw the eye back to it. Its close is the key bar's Esc.
export function SendHeld(props: {
  panel: Panel;
  nudge: number;
  onKey: (data: string) => boolean;
  onDone: () => void;
}) {
  const who = useAgentName();
  return (
    <div
      key={props.nudge}
      className={`send-held${props.nudge ? ' nudged' : ''}`}
      role="status"
      aria-label={t.sendPaused}
    >
      <span>
        <b>{t.agentHasOpen(who, panelName(props.panel))}</b>
        <small>{t.heldWhilePanel}</small>
      </span>
      <button
        className="btn small"
        {...press(() => props.onKey('\x1b') && props.onDone())}
      >
        {t.close}
      </button>
    </div>
  );
}

// limitActions: what the note of a limit that stopped the chat offers besides trying again.
export function ChatView({ session, s, limitActions }: { session: Session; s: SessionSnapshot; limitActions?: ReactNode }) {
  const { view, status, id: sessionId } = s;
  const who = useAgentName();
  const dialogUp = !!s.dialog;
  const { entries } = useMemo(
    () => chatEntries({ kind: s.kind, view, status, answers: answers.answersOf(sessionId), queued: s.queued.length, dialog: dialogUp }),
    [s.kind, view, status, sessionId, s.queued.length, dialogUp],
  );
  const now = useNow(status === 'working');
  const scroller = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const lastTop = useRef(0);
  const touching = useRef(false);
  const sendingSeen = useRef<ReadonlySet<string>>(new Set());
  const [away, setAway] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [screenShown, setScreenShown] = useState(false);
  const onScreen = () => setScreenShown(true);
  // Where the reader was when earlier turns were about to go in above, so they can stay there.
  const anchor = useRef<{ height: number; top: number } | null>(null);

  const older = useCallback(
    () =>
      journals.older(sessionId, () => {
        const el = scroller.current;
        if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop };
      }),
    [sessionId]
  );

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // A message sent from here takes the reader back to the end, wherever they were reading.
    const sending = view.messages.filter((m) => m.state === 'sending');
    const sentNow = sending.some((m) => !sendingSeen.current.has(m.id));
    sendingSeen.current = new Set(sending.map((m) => m.id));
    if (sentNow) stick.current = true;
    const a = anchor.current;
    anchor.current = null;
    if (a) el.scrollTop = a.top + el.scrollHeight - a.height;
    else if (stick.current && !touching.current) el.scrollTop = el.scrollHeight;
    // Too few turns to scroll means no way to reach the top and ask for more.
    if (view.older && el.clientHeight && el.scrollHeight <= el.clientHeight) void older();
  }, [view, status, older]);

  // Following the end keeps it in view whatever changes the size: the keyboard coming or going, the
  // composer growing, a picture loading. Not under the reader's finger.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const pin = () => {
      if (stick.current && !touching.current) el.scrollTop = el.scrollHeight;
    };
    const watch = new ResizeObserver(pin);
    watch.observe(el);
    for (const child of el.children) watch.observe(child);
    const children = new MutationObserver((changes) => {
      for (const c of changes)
        for (const n of c.addedNodes)
          if (n instanceof Element) watch.observe(n);
    });
    children.observe(el, { childList: true });
    return () => {
      watch.disconnect();
      children.disconnect();
    };
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX;
    // Only the reader moving up lets go of the end; the view shrinking under it does not.
    const movedUp = el.scrollTop < lastTop.current;
    lastTop.current = el.scrollTop;
    stick.current = atBottom || (stick.current && !movedUp);
    setAway(!atBottom);
    if (el.scrollTop < NEAR_TOP_PX) void older();
  };
  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const entry = (e: ChatEntry) => {
    switch (e.kind) {
      case 'tools':
        return <ToolsRow sessionId={sessionId} tools={e.tools} going={e.going} end={e.end} onOpen={setViewing} />;
      case 'turn':
        return (
          <TurnView
            sessionId={sessionId}
            t={e.turn}
            repeated={e.repeated}
            sent={e.sent}
            last={e.last}
            onOpen={setViewing}
            onRewind={e.rewind ? () => session.send('/rewind\r') : undefined}
            onRetry={e.retry ? () => session.send(`${t.continueWord}\r`) : undefined}
            retryActions={isLimit(e.turn) && limitActions}
          />
        );
      case 'answer':
        return (
          <div className="chat-answered" title={e.answer.question}>
            <span>
              {t.youChose}
              {e.answer.said}
            </span>
            {e.answer.code && <code>{e.answer.code}</code>}
          </div>
        );
      case 'empty':
        return (
          <div className="chat-empty">
            <strong>{t.noConversation}</strong>
            <span className="muted">{t.typeBelow}</span>
          </div>
        );
      case 'live':
        return (
          <div className="reply chat-live" aria-live="polite">
            <div className="chat-live-head">{t.agentWriting(who)}</div>
            {e.text}
          </div>
        );
      case 'bubble':
        return <OutboxBubbles sessionId={sessionId} messages={[e.message]} onOpen={setViewing} />;
      case 'failed':
        return <div className="chat-note">{t.chatUnreadable}</div>;
      case 'background':
        return <BackgroundBar running={e.running} onManage={() => session.send('/tasks\r')} />;
      case 'working':
        return (
          <div className="chat-working">
            <span className="chat-working-now">
              <span className="spinner" aria-hidden />
              {t.claudeWorking}
              {e.since !== null && ` · ${elapsed(e.since, now)}`}
            </span>
          </div>
        );
      case 'ask':
        return <PermissionCard key={e.ask.id} sessionId={sessionId} ask={e.ask} onScreen={onScreen} onDone={session.reread} />;
      case 'choice':
        return <ChoiceCard sessionId={sessionId} choices={e.choices} onKey={session.press} onScreen={onScreen} onDone={session.reread} />;
      case 'tick':
        return <TickCard sessionId={sessionId} choices={e.choices} onKey={session.press} onScreen={onScreen} onDone={session.reread} />;
      case 'waiting':
        return (
          <div className="chat-waiting" role="status">
            <span>{t.agentWaiting(who)}</span>
            <button className="btn small" onClick={onScreen}>
              {t.showScreen}
            </button>
          </div>
        );
    }
  };

  return (
    <div className="chat-layer">
      <div
        className="chat"
        data-testid="chat"
        ref={scroller}
        onScroll={onScroll}
        onTouchStart={() => (touching.current = true)}
        onTouchEnd={() => (touching.current = false)}
        onTouchCancel={() => (touching.current = false)}
      >
        {view.loadingOlder && (
          <div
            className="chat-older"
            role="status"
            aria-label={t.loadingEarlier}
          >
            <span className="spinner" />
          </div>
        )}
        {entries.map((e) => (
          <Fragment key={e.key}>{entry(e)}</Fragment>
        ))}
        {!view.synced && !view.failed && <div className="chat-empty muted">{status === 'ended' ? t.endedNoChat : t.reading}</div>}
        {s.dialog?.panel && <PanelCard panel={s.dialog.panel} onKey={session.press} onScreen={onScreen} onDone={session.settle} />}
        {s.dialog?.choices && !s.dialog.panel && (
          <ChoiceCard sessionId={sessionId} choices={s.dialog.choices} onKey={session.press} onScreen={onScreen} onDone={session.settle} />
        )}
      </div>
      {away && (
        <button className="to-bottom" aria-label={t.toBottom} onClick={toBottom}>
          <IconDown />
        </button>
      )}
      {viewing && <Viewer src={viewing} onClose={() => setViewing(null)} />}
      {screenShown && (
        <ScreenSheet
          sessionId={sessionId}
          onClose={() => setScreenShown(false)}
          keys={s.ended ? undefined : { ctrlArmed: s.ctrl, onCtrl: () => session.armCtrl(!s.ctrl), onKey: session.send, onPaste: () => void session.paste() }}
        />
      )}
    </div>
  );
}

const elapsed = (since: number, now: number) => duration(Math.max(0, now - since));
