import { askOptions, type Ask } from '@workoffdesk/client/model/chat';
import { t } from '@workoffdesk/i18n';
import { useAskAnswer } from './common';
import { press } from '../KeyBar';
import { useAgentName } from '@workoffdesk/react/agentName';

// A permission prompt Claude Code said it holds: answered by what it means, not by keys, so an answer
// meant for it reaches it or nothing.
export function PermissionCard(props: { sessionId: string; ask: Ask; onScreen: () => void; onDone: () => void }) {
  const who = useAgentName();
  const { ask } = props;
  const head = t.allowTool(ask.tool);
  const { busy, note, send } = useAskAnswer(props.sessionId, ask, head, props.onDone);
  return (
    <div className="chat-choice" role="group" aria-label={t.agentAsks(who)}>
      <div className="choice-context">
        <strong>{head}</strong>
        {ask.title && ask.title !== ask.detail && `\n${ask.title}`}
      </div>
      {ask.detail && <pre className="panel-body">{ask.detail}</pre>}
      {askOptions(ask).map((o) => (
        <button key={o.label} className="choice-opt" disabled={busy} {...press(() => send(o.answer, o.label, o.code))}>
          <strong>{o.label}</strong>
          {o.detail && <span>{o.detail}</span>}
          {o.code && <code>{o.code}</code>}
        </button>
      ))}
      {note && <div className="chat-note">{note}</div>}
      <div className="choice-actions">
        <button className="btn small" onClick={props.onScreen}>
          {t.showScreen}
        </button>
      </div>
    </div>
  );
}
