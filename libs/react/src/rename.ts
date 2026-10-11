import { errorText, type Api, type TermSession } from '@workoffdesk/client/base/api';
import { ownName } from '@workoffdesk/client/model/format';
import { renameSession } from '@workoffdesk/client/sessions/rename';
import type { SessionList } from '@workoffdesk/client/sessions/sessionList';
import { t } from '@workoffdesk/i18n';
import { useState } from 'react';

// Renaming a session, never to an empty name. A save closes at once: the list shows the name while it goes to
// the Mac, however slow the line, and `onFailed` says why when the Mac does not take it.
export function useRename(api: Api, list: Pick<SessionList, 'naming'>, session: TermSession, onClose: () => void, onFailed: (why: string) => void) {
  const [name, setName] = useState(ownName(session));
  const canSave = name.trim() !== '';
  const save = () => {
    if (!canSave) return;
    onClose();
    if (name === ownName(session)) return;
    renameSession(api, list, session.id, name).catch((e: unknown) => onFailed(errorText(e, t.renameFailed)));
  };
  return { name, setName, canSave, save };
}
