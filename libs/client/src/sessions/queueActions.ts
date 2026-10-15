import { t } from '@workoffdesk/i18n';
import { ApiError, errorText, type Api, type ApiInit, type Queued } from '../base/api';
import type { Journals } from '../journal/journal';
import type { JournalRow } from '../journal/journalRows';

// What the queue tray does to a message waiting for Claude: send it now, move it, take it back. What the Mac
// answers goes into the journal; a 404 is the Mac saying it does not hold the message, and what showed it
// waiting is read again.
export function queueActions(o: {
  api: Api;
  id: string;
  base: string;
  journals: Pick<Journals, 'apply' | 'refresh'>;
  say: (text: string) => void;
  giveBack: (text: string) => void;
  // Messages being taken back are out of the tray until the Mac answers.
  taking: (qid: string, on: boolean) => void;
}) {
  const answered = (r: { message: JournalRow | null }) => {
    if (r.message) o.journals.apply(o.id, [r.message]);
  };
  const gone = (e: unknown, otherwise: string) => {
    const notHeld = e instanceof ApiError && e.status === 404;
    if (notHeld) o.journals.refresh(o.id);
    o.say(notHeld ? t.alreadySent : errorText(e, otherwise, otherwise));
  };
  const url = (q: Queued) => `${o.base}/messages/${q.id}`;
  const act = (q: Queued, init: ApiInit, failed: string) =>
    o.api<{ message: JournalRow | null }>(url(q), { method: 'POST', ...init }).then(
      (r) => {
        answered(r);
        return true;
      },
      (e) => {
        gone(e, failed);
        return false;
      },
    );
  return {
    // Taken once however often it arrives, so it is sent again across a Mac that is restarting; a move is not.
    sendNow: (q: Queued) => act(q, { json: {}, idempotent: true }, t.notSentRetry),
    move: (q: Queued, by: -1 | 1) => act(q, { json: { move: by } }, t.notMoved),
    // Taken back, to change in the composer or to drop; not taken back after all, it shows as the Mac has it.
    unsend(q: Queued, edit: boolean): Promise<boolean> {
      o.taking(q.id, true);
      return o
        .api<{ text: string; message: JournalRow | null }>(url(q), { method: 'DELETE' })
        .then(
          (r) => {
            answered(r);
            if (edit) o.giveBack(r.text);
            return true;
          },
          (e) => {
            gone(e, edit ? t.takeBackFailed : t.deleteFailed);
            return false;
          },
        )
        .finally(() => o.taking(q.id, false));
    },
  };
}
