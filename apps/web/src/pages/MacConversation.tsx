import { useState } from 'react';
import { agentName, api, MACHINE, type Agent } from '../api';
import { rows, turns } from '@workoffdesk/client/model/chat';
import { useChat } from '../components/ChatView';
import { useStayAtEnd } from '../components/stayAtEnd';
import { TurnView } from '../components/TurnView';
import { ToolsRow } from '../components/turn/ToolsRow';
import { shortPath, timeAgo } from '@workoffdesk/client/model/format';
import { keptConversation } from '@workoffdesk/client/sessions/macRecent';
import { onMacSays, previewChatUrl } from '@workoffdesk/client/sessions/newSession';
import { useMacConversation } from '@workoffdesk/react/macConversation';
import { ClaudeConversation } from '@workoffdesk/react/claudeConversation';
import { PageHeader } from '../components/PageHeader';
import { navigate } from '../router';
import { storage } from '../platform';
import { t } from '@workoffdesk/i18n';

// A Claude or Codex conversation from this Mac, read before picking it up here; nothing on it is sent to the
// agent.
export function MacConversation({ agent, sid }: { agent: Agent; sid: string }) {
  const { chat, failed } = useChat(`${agent}:${sid}`, previewChatUrl(agent, sid));
  const [kept] = useState(() => keptConversation(storage, sid));
  const { info, busy, error, unreachable, pick, waiting, missed, resume, takeOverNow, takeOverWhenDone, cancel } = useMacConversation(
    api,
    agent,
    sid,
    (id) => navigate(`/m/${MACHINE}/s/${id}`),
    kept,
  );
  const shown = chat ? turns(chat.items, chat.base) : [];
  // The foot's buttons come once the Mac answers, after the turns are shown.
  const { scroller, noteWhere } = useStayAtEnd(shown.length);

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
          <ClaudeConversation.Provider value={agent === 'claude' ? sid : null}>
            {rows(shown).map((r) =>
              r.k === 'tools' ? (
                <ToolsRow key={r.key} sessionId={sid} tools={r.tools} going={r.going} onOpen={() => {}} />
              ) : (
                <TurnView key={r.t.key} sessionId={sid} t={r.t} onOpen={() => {}} />
              )
            )}
          </ClaudeConversation.Provider>
          {!chat && !failed && <div className="chat-empty muted">{t.reading}</div>}
          {failed && <div className="chat-note">{t.cannotRead}</div>}
        </div>
      </div>
      <div className="claude-view-foot">
        {error && <div className="alert">{error}</div>}
        {unreachable && !error && <div className="alert">{t.noServer}</div>}
        {missed && !error && <div className="alert">{t.takeOverMissed}</div>}
        {info === null && <div className="alert">{t.notOnMac}</div>}
        {pick?.do === 'takeOver' && (
          <strong>
            {[onMacSays(pick.status), pick.terminals > 1 && t.openInTerminals(pick.terminals)]
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
            {pick.status === 'background' && <span className="muted">{t.takeOverStopsCommands}</span>}
            {(pick.status === 'idle' || pick.status === 'background') && (
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
            <span className="claude-view-note">
              {t.takeOverNote(agentName(agent))}
              <br />
              {t.backAtMac}
              <code>workoffdesk attach</code>
            </span>
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
            aria-busy={info === undefined}
            onClick={() => (pick?.do === 'open' ? navigate(`/m/${MACHINE}/s/${pick.id}`) : void resume())}
          >
            {pick?.do === 'open' ? t.openAlreadyOnPhone : pick?.do === 'none' ? (agent === 'codex' ? t.openElsewhereNoResume : t.inBackgroundNoResume) : t.continueOnPhone}
          </button>
        )}
      </div>
    </div>
  );
}
