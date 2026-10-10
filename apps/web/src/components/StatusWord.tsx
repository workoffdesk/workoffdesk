import { isAgent, type TermSession } from '../api';
import { statusLabel } from '@workoffdesk/client/model/format';
import { t } from '@workoffdesk/i18n';

// The status as the line under a session's title says it: a dot and the word, coloured as the phone colours it.
export function StatusWord({ s }: { s: Pick<TermSession, 'kind' | 'status'> | 'reconnecting' }) {
  if (s === 'reconnecting') return <span className="status-word">● {t.reconnecting}</span>;
  const look = isAgent(s.kind) ? s.status : null;
  return <span className={look ? `status-word ${look}` : 'status-word'}>● {statusLabel(s)}</span>;
}
