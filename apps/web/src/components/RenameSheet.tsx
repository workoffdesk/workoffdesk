import { api, type TermSession } from '../api';
import { dirName } from '@workoffdesk/client/model/format';
import { useRename } from '@workoffdesk/react/rename';
import { Sheet } from './Sheet';
import { t } from '@workoffdesk/i18n';

export function RenameSheet({ session, onClose }: { session: TermSession; onClose: () => void }) {
  const { name, setName, busy, canSave, error, save } = useRename(api, session, onClose);
  return (
    <Sheet title={t.rename} onClose={onClose}>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <form
        className="rename-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
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
        <button className="btn small primary" type="submit" disabled={busy || !canSave}>
          {t.save}
        </button>
      </form>
      <p className="sheet-note">{t.renameNote}</p>
    </Sheet>
  );
}
