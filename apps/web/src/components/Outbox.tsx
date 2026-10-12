import type { Message } from '@workoffdesk/client/journal/journalRows';
import { SentBubble } from './turn/bubbles';
import { t } from '@workoffdesk/i18n';
import { quitOnMac } from '@workoffdesk/client/sessions/quitOnMac';
import { useState } from 'react';
import { api } from '../api';
import { ActionSheet } from './ActionSheet';

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

// Above the composer while the conversation is open in a terminal on the Mac too, in a Claude of its own, which it
// quits; one there at work only once told to. The bar goes once the Mac no longer has it open.
export function OnMacBar({ terminals, sessionId, onError }: { terminals: number; sessionId: string; onError: (text: string) => void }) {
  const [quitting, setQuitting] = useState(false);
  const [asking, setAsking] = useState<((yes: boolean) => void) | null>(null);
  const answer = (yes: boolean) => {
    asking?.(yes);
    setAsking(null);
  };
  const quit = () => {
    setQuitting(true);
    void quitOnMac(api, sessionId, () => new Promise<boolean>((done) => setAsking(() => done))).then((why) => {
      setQuitting(false);
      if (why) onError(why);
    });
  };
  return (
    <div className="on-mac-note" role="status" aria-label={t.alsoOnMac(terminals)}>
      <b>{t.alsoOnMac(terminals)}</b>
      <span>
        <small>{t.alsoOnMacSub}</small>
        <button className="btn small" disabled={quitting} aria-busy={quitting} onClick={quit}>
          {t.quitOnMac}
        </button>
      </span>
      {asking && (
        <ActionSheet
          title={t.alsoOnMac(terminals)}
          message={t.quitOnMacBusy}
          side
          actions={[{ label: t.quitAnyway, run: () => answer(true), destructive: true }]}
          onClose={() => answer(false)}
        />
      )}
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
