import { useEffect, useState } from 'react';
import { rows, turns } from '@workoffdesk/client/model/chat';
import { subagentChatUrl, subagentOf } from '@workoffdesk/client/sessions/subagent';
import { ClaudeConversation } from '@workoffdesk/react/claudeConversation';
import { t } from '@workoffdesk/i18n';
import { api } from '../api';
import { useChat } from '../components/ChatView';
import { PageHeader } from '../components/PageHeader';
import { useStayAtEnd } from '../components/stayAtEnd';
import { TurnView } from '../components/TurnView';
import { ToolsRow } from '../components/turn/ToolsRow';
import { navigate } from '../router';

// What a sub-agent of a Claude conversation did, and is doing, from its own transcript; nothing is sent to it.
// Its own sub-agents are found under the same conversation.
export function Subagent({ sid, tool }: { sid: string; tool: string }) {
  const { chat, failed } = useChat(`claude:${sid}:${tool}`, subagentChatUrl(sid, tool));
  const [about, setAbout] = useState<string | null>(null);
  useEffect(() => {
    subagentOf(api, sid, tool).then(
      (a) => setAbout(a.description),
      () => setAbout(null),
    );
  }, [sid, tool]);
  const shown = chat ? turns(chat.items, chat.base) : [];
  const { scroller, noteWhere } = useStayAtEnd(shown.length);
  const back = () => (history.length > 1 ? history.back() : navigate('/'));

  return (
    <div className="term-page">
      <PageHeader
        onBack={back}
        title={
          <div className="term-title">
            <strong>{about ?? t.subagent}</strong>
          </div>
        }
        right={<span className="chip">{t.readOnly}</span>}
      />
      <div className="term-wrap">
        <div className="chat" data-testid="chat" ref={scroller} onScroll={noteWhere}>
          <ClaudeConversation.Provider value={sid}>
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
    </div>
  );
}
