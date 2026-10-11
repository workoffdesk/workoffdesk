import { api, type TermSession } from '../api';
import { dirName } from '@workoffdesk/client/model/format';
import { useRename } from '@workoffdesk/react/rename';
import { sessionList } from '../platform';
import { Sheet } from './Sheet';
import { t } from '@workoffdesk/i18n';

export function RenameSheet({ session, onClose, onFailed }: { session: TermSession; onClose: () => void; onFailed: (why: string) => void }) {
  const { name, setName, canSave, save } = useRename(api, sessionList, session, onClose, onFailed);
  return (
    <Sheet title={t.rename} onClose={onClose}>
      <form
        className="rename-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          className="search"
          aria-label={t.name}
          placeholder={dirName(session.cwd)}
          value={name}
          onChange={(e) => setName(e.target.value)}
          enterKeyHint="done"
          autoFocus
        />
        <button className="btn small primary" type="submit" disabled={!canSave}>
          {t.save}
        </button>
      </form>
      <p className="sheet-note">{t.renameNote}</p>
    </Sheet>
  );
}
