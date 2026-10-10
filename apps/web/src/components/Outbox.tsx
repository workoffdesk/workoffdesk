import type { Message } from '@workoffdesk/client/journal/journalRows';
import { SentBubble } from './turn/bubbles';
import { t } from '@workoffdesk/i18n';

// Above the composer while Claude compacts its conversation, from the moment it starts.
export function CompactingBar({ count }: { count: number }) {
  return (
    <div className="send-held compacting" role="status" aria-label={t.compactingContext}>
      <span>
        <b>{t.compactingContext}</b>
        <small>{count ? t.compactingQueued(count) : t.compactingWillQueue}</small>
      </span>
    </div>
  );
}

// Above the composer while the conversation is open in a terminal on the Mac too, in a Claude of its own.
export function OnMacBar({ terminals, sessionId }: { terminals: number; sessionId: string }) {
  return (
    <div className="send-held" role="status" aria-label={t.alsoOnMac(terminals)}>
      <span>
        <b>{t.alsoOnMac(terminals)}</b>
        <small>{t.alsoOnMacSub(sessionId)}</small>
      </span>
    </div>
  );
}

// The messages on their way to Claude, after the conversation (journal.ts onShow); what waits is above the
// composer (QueueTray).
export function OutboxBubbles(props: { sessionId: string; messages: Message[]; onOpen: (src: string) => void }) {
  if (!props.messages.length) return null;
  return (
    <ul className="outbox">
      {props.messages.map((m) =>
        m.state === 'sending' ? (
          <li key={m.id} className="outbox-item held" aria-label={t.sendingMessage}>
            <SentBubble sessionId={props.sessionId} text={m.text} onOpen={props.onOpen} />
            <small>{t.sending}</small>
          </li>
        ) : (
          <li key={m.id} className="outbox-item" aria-label={t.sentMessage}>
            <SentBubble sessionId={props.sessionId} text={m.text} onOpen={props.onOpen} />
            <small>{t.sent}</small>
          </li>
        ),
      )}
    </ul>
  );
}
