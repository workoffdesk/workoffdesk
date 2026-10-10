import { useLayoutEffect, useRef } from 'react';
import { agentName, api, MACHINE, type Agent } from '../api';
import { rows, turns } from '@workoffdesk/client/model/chat';
import { useChat } from '../components/ChatView';
import { TurnView } from '../components/TurnView';
import { ToolsRow } from '../components/turn/ToolsRow';
import { shortPath, timeAgo } from '@workoffdesk/client/model/format';
import { previewChatUrl } from '@workoffdesk/client/sessions/newSession';
import { useMacConversation } from '@workoffdesk/react/macConversation';
import { PageHeader } from '../components/PageHeader';
import { navigate } from '../router';
import { t } from '@workoffdesk/i18n';

// A Claude or Codex conversation from this Mac, read before picking it up here; nothing on it is sent to the
// agent.
export function MacConversation({ agent, sid }: { agent: Agent; sid: string }) {
  const { chat, failed } = useChat(`${agent}:${sid}`, previewChatUrl(agent, sid));
  const { info, busy, error, unreachable, pick, waiting, missed, resume, takeOverNow, takeOverWhenDone, cancel } = useMacConversation(api, agent, sid, (id) =>
    navigate(`/m/${MACHINE}/s/${id}`),
  );
  const scroller = useRef<HTMLDivElement>(null);
  const shown = chat ? turns(chat.items, chat.base) : [];

  // The end stays in sight while the reader is at it, as turns come in and as the page and the foot below
  // it change size (the foot's buttons come once the Mac answers, after the turns are shown).
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const keep = () => {
      if (atEnd.current) el.scrollTop = el.scrollHeight;
    };
    keep();
    const seen = new ResizeObserver(keep);
    seen.observe(el);
    for (const child of el.children) seen.observe(child);
    return () => seen.disconnect();
  }, [shown.length]);
  const noteWhere = () => {
    const el = scroller.current;
    if (el) atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div className="term-page">
      <PageHeader
        onBack={() => navigate('/')}
        title={
          <div className="term-title">
            <strong>{info?.title ?? t.macSession}</strong>
            {info && <span>{`${shortPath(info.cwd ?? '')} · ${timeAgo(info.lastActivity)}`}</span>}
          </div>
        }
        right={<span className="chip">{t.readOnly}</span>}
      />
      <div className="term-wrap">
        <div className="chat" ref={scroller} onScroll={noteWhere}>
          {rows(shown).map((r) =>
            r.k === 'tools' ? (
              <ToolsRow key={r.key} sessionId={sid} tools={r.tools} going={r.going} onOpen={() => {}} />
            ) : (
              <TurnView key={r.t.key} sessionId={sid} t={r.t} onOpen={() => {}} />
            )
          )}
          {!chat && !failed && <div className="chat-empty muted">{t.reading}</div>}
          {failed && <div className="chat-note">{t.cannotRead}</div>}
        </div>
      </div>
      <div className="claude-view-foot">
        {error && <div className="alert">{error}</div>}
        {unreachable && !error && <div className="alert">{t.noServer}</div>}
        {missed && !error && <div className="alert">{t.takeOverMissed}</div>}
        {pick?.do === 'takeOver' && (
          <strong>
            {[pick.status === 'busy' ? t.onMacBusy : pick.status === 'waiting' ? t.onMacWaiting : t.onMacIdle, pick.terminals > 1 && t.openInTerminals(pick.terminals)]
              .filter(Boolean)
              .join(' · ')}
          </strong>
        )}
        {pick?.do === 'takeOver' && waiting ? (
          <>
            <span className="muted">{t.takingOverWait}</span>
            <button className="btn primary" disabled={busy} onClick={takeOverNow}>
              {t.takeOverInterrupt}
            </button>
            <button className="btn" disabled={busy} onClick={cancel}>
              {t.takeOverCancel}
            </button>
          </>
        ) : pick?.do === 'takeOver' ? (
          <>
            {pick.status === 'idle' && (
              <button className="btn primary" disabled={busy} onClick={takeOverNow}>
                {t.takeOverNow}
              </button>
            )}
            {pick.status === 'busy' && (
              <>
                <button className="btn primary" disabled={busy} onClick={takeOverWhenDone}>
                  {t.takeOverWhenDone}
                </button>
                <button className="btn" disabled={busy} onClick={takeOverNow}>
                  {t.takeOverInterrupt}
                </button>
              </>
            )}
            {pick.status === 'waiting' && (
              <>
                <span className="muted">{t.takeOverDropsQuestion}</span>
                <button className="btn primary" disabled={busy} onClick={takeOverNow}>
                  {t.takeOverNow}
                </button>
              </>
            )}
            <span className="claude-view-note">{t.takeOverNote(agentName(agent))}</span>
          </>
        ) : pick?.do === 'gone' ? (
          <>
            <button className="btn primary" disabled>
              {t.folderGoneNoResume}
            </button>
            <span className="claude-view-note">{t.folderGoneSub(shortPath(info?.cwd ?? ''))}</span>
          </>
        ) : (
          <button
            className="btn primary"
            disabled={busy || !info?.cwd || !pick || pick.do === 'none'}
            onClick={() => (pick?.do === 'open' ? navigate(`/m/${MACHINE}/s/${pick.id}`) : void resume())}
          >
            {pick?.do === 'open' ? t.openAlreadyOnPhone : pick?.do === 'none' ? (agent === 'codex' ? t.openElsewhereNoResume : t.inBackgroundNoResume) : t.continueOnPhone}
          </button>
        )}
      </div>
    </div>
  );
}
