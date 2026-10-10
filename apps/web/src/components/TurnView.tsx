import { noteText, type Turn } from '@workoffdesk/client/model/chat';
import type { ReactNode } from 'react';
import { t } from '@workoffdesk/i18n';
import { useAgentName } from '@workoffdesk/react/agentName';
import { Reply, ReplyWithImages, ShownAbove } from './turn/Reply';
import { ChangesCard, DiffCount, DiffView, ToolSummary } from './turn/ToolsRow';
import { type Opener, Pictures } from './turn/media';
import { Mine } from './turn/bubbles';

// The repeated images of a turn are the ones an earlier turn already shows (shownEarlier). A turn of the
// user's that left workoffdesk's queue reads as sent until Claude answers it.
// last: the turn ends a reply, which gets the reply's actions.
export function TurnView(props: {
  sessionId: string;
  t: Turn;
  repeated?: Set<string>;
  sent?: boolean;
  last?: boolean;
  onOpen: Opener;
  onRewind?: () => void;
  onRetry?: () => void;
  // Beside "Try again", what else the stopped note offers.
  retryActions?: ReactNode;
}) {
  const who = useAgentName();
  const { sessionId, t: turn, repeated, onOpen } = props;
  switch (turn.k) {
    case 'user':
      if (!props.sent) return <Mine sessionId={sessionId} text={turn.text} at={turn.at} onOpen={onOpen} onRewind={props.onRewind} />;
      return (
        <div className="outbox-item" role="group" aria-label={t.sentMessage}>
          <Mine sessionId={sessionId} text={turn.text} onOpen={onOpen} />
          <small>{t.sent}</small>
        </div>
      );
    case 'text':
      return <ReplyWithImages sessionId={sessionId} text={turn.text} repeated={repeated} onOpen={onOpen} last={props.last} />;
    case 'note':
      if (turn.retry)
        return (
          <div className={`chat-stopped ${turn.detail ? 'failed' : ''}`} role="status">
            <span>
              {turn.detail ? '⊗' : '×'} {noteText(turn)}
              {turn.detail && <small> · {turn.detail}</small>}
            </span>
            {props.onRetry && (
              <button className="btn small" onClick={props.onRetry}>
                {t.tryAgain}
              </button>
            )}
            {props.onRetry && props.retryActions}
          </div>
        );
      if (!turn.detail) return <div className="chat-note">{noteText(turn)}</div>;
      return (
        <details className="chat-note">
          <summary>{noteText(turn)}</summary>
          <div className="chat-note-detail">{turn.detail}</div>
        </details>
      );
    case 'changes':
      return <ChangesCard files={turn.files} />;
    case 'tool': {
      if (turn.plan)
        return (
          <div className="chat-plan" data-tool={turn.id}>
            <div className="chat-plan-head">{t.plan}</div>
            <Reply text={turn.plan} />
          </div>
        );
      const diff = turn.result?.diff;
      const tool = (
        <details className={`chat-tool ${turn.result?.error ? 'error' : ''}`} data-tool={turn.id}>
          <summary>
            <span className="tool-name">{turn.name}</span>
            <ToolSummary name={turn.name} summary={turn.summary} />
            {diff && <DiffCount d={diff} />}
            {!turn.result && <span className="tool-running">{t.running}</span>}
          </summary>
          {diff ? <DiffView d={diff} /> : <pre>{turn.result ? (turn.result.stopped ? t.toolStopped(who) : turn.result.text || t.noOutput) : t.noResultYet}</pre>}
        </details>
      );
      if (!turn.result?.image || turn.name !== 'Read') return tool;
      return (
        <>
          {tool}
          {repeated?.has(turn.summary) ? (
            <ShownAbove path={turn.summary} />
          ) : (
            <Pictures sessionId={sessionId} side="theirs" paths={[turn.summary]} read onOpen={onOpen} />
          )}
        </>
      );
    }
  }
}
