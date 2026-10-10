import type { Attachment } from '@workoffdesk/client/composer/composer';
import { t } from '@workoffdesk/i18n';
import { IconClose, IconDoc, IconPlay } from '../../icons';
import { MiddleName } from '../MiddleName';

// A picture by itself, a video by its still, a file by its name; a spinner while it is on its way up.
// A file by its name and how much is up, a video dark with how much is up, a picture by itself.
export function AttachmentTile({ a, onRemove }: { a: Attachment<string>; onRemove: () => void }) {
  const uploading = a.piece === null;
  const share = `${Math.round((a.sent ?? 0) * 100)}%`;
  return (
    <span className={`attachment ${a.kind}`} aria-label={uploading ? `${a.name}, ${t.uploading}` : a.name}>
      {a.kind === 'file' ? (
        <>
          <IconDoc />
          <span className="attachment-text">
            <MiddleName className="attachment-name" name={a.name} lines={2} />
            {uploading && <span className="attachment-sent">{`${t.uploading} ${share}`}</span>}
          </span>
        </>
      ) : a.kind === 'video' ? (
        <span className="attachment-cover">{uploading ? share : <IconPlay />}</span>
      ) : (
        <>
          {a.source && <img src={a.source} alt="" />}
          {uploading && (
            <span className="attachment-cover">
              <span className="spinner" />
            </span>
          )}
        </>
      )}
      <button className="remove" aria-label={a.kind === 'picture' ? t.removeImage : t.removeFile} onClick={onRemove}>
        <IconClose />
      </button>
    </span>
  );
}
