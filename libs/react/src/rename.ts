import { errorText, MACHINE, type Api, type TermSession } from '@workoffdesk/client/base/api';
import { ownName } from '@workoffdesk/client/model/format';
import { t } from '@workoffdesk/i18n';
import { useState } from 'react';

// Renaming a session, never to an empty name. The new name comes back with the list from the Mac. Naming twice
// is naming once, so a save that hangs on a bad line is sent again rather than left unanswered.
export function useRename(api: Api, session: TermSession, onClose: () => void) {
  const [name, setName] = useState(ownName(session));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = name.trim() !== '';
  const save = async () => {
    if (busy || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/m/${MACHINE}/sessions/${session.id}`, { method: 'PATCH', json: { title: name }, idempotent: true });
      onClose();
    } catch (e) {
      setError(errorText(e, t.renameFailed));
      setBusy(false);
    }
  };
  return { name, setName, busy, canSave, error, save };
}
