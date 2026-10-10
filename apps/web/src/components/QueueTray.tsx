import { useState } from 'react';
import type { InQueue } from '@workoffdesk/client/journal/journalRows';
import { press } from './KeyBar';
import { t } from '@workoffdesk/i18n';
import { mineInBrief } from '@workoffdesk/client/chat/images';
import { useAgentName } from '@workoffdesk/react/agentName';

// Above the composer: what Claude has not read yet, in the order it will. What is in Claude's own queue
// waits for its next step; what the Mac holds can be taken back to change, moved or dropped.
export function QueueTray(props: {
  queued: InQueue[];
  why: string;
  onSendNow?: (q: InQueue) => void;
  onMove: (q: InQueue, by: -1 | 1) => void;
  onEdit: (q: InQueue) => void;
  onDrop: (q: InQueue) => void;
}) {
  const who = useAgentName();
  const [open, setOpen] = useState<string | null>(null);
  if (!props.queued.length) return null;
  // Only what the Mac holds can be moved, among itself.
  const macs = props.queued.filter((q) => q.waits === 'mac');
  return (
    <section className="queue" aria-label={t.queuedMessages}>
      <header className="queue-head">
        <b>{t.queued(props.queued.length)}</b>
        <small>{props.why}</small>
      </header>
      <ol>
        {props.queued.map((q, i) => (
          <li key={q.id} className={open === q.id ? 'queue-item open' : 'queue-item'}>
            <div className="queue-row">
              <span className="queue-n">{i + 1}</span>
              <button className="queue-text" aria-expanded={open === q.id} onClick={() => setOpen(open === q.id ? null : q.id)}>
                {mineInBrief(q.text)}
              </button>
              {q.waits !== 'mac' ? (
                <small>{q.waits === 'sending' ? t.sending : t.inAgentsQueue(who)}</small>
              ) : (
                <>
                  <button className="btn small" {...press(() => props.onEdit(q))}>
                    {t.edit}
                  </button>
                  {props.onSendNow && (
                    <button className="btn small" {...press(() => props.onSendNow?.(q))}>
                      {t.sendNow}
                    </button>
                  )}
                </>
              )}
            </div>
            {open === q.id && q.waits === 'mac' && (
              <div className="queue-actions">
                <button className="btn small" disabled={q.id === macs[0]?.id} {...press(() => props.onMove(q, -1))}>
                  {t.moveUp}
                </button>
                <button className="btn small" disabled={q.id === macs.at(-1)?.id} {...press(() => props.onMove(q, 1))}>
                  {t.moveDown}
                </button>
                <button className="btn small danger" {...press(() => props.onDrop(q))}>
                  {t.delete}
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
