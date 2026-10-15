import { errorText } from '@workoffdesk/client/base/api';
import { noteText, type Turn } from '@workoffdesk/client/model/chat';
import { sentFrom } from '@workoffdesk/client/sessions/peer';
import { useState, type ReactNode } from 'react';
import { api, MACHINE } from '../api';
import { navigate } from '../router';
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
          {'event' in turn && turn.event.e === 'peer' && turn.event.pid !== undefined && <GoToSender pid={turn.event.pid} name={turn.event.from} />}
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
          {turn.input && <pre className="tool-input">{turn.input}</pre>}
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

// A message from another Claude on the Mac leads to it, or says why it cannot.
function GoToSender({ pid, name }: { pid: number; name: string }) {
  const [said, setSaid] = useState<string | null>(null);
  const [going, setGoing] = useState(false);
  const go = () => {
    setGoing(true);
    setSaid(null);
    sentFrom(api, pid, name).then(
      (to) => navigate('session' in to ? `/m/${MACHINE}/s/${to.session}` : `/claude/${to.onMac}`),
      (e: unknown) => {
        setGoing(false);
        setSaid(errorText(e, t.failed));
      },
    );
  };
  return (
    <div className="chat-note-go">
      <button className="btn small" disabled={going} onClick={go}>
        {t.goToSender}
      </button>
      {said && <small role="alert">{said}</small>}
    </div>
  );
}
