import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { IconClose, IconDoc, IconPlay } from '../../icons';
import { MiddleName } from '../MiddleName';
import { goneText, imageKey, imageSrc, type SentFile } from '@workoffdesk/client/chat/images';
import { t } from '@workoffdesk/i18n';

// Pictures that failed to load, so a chat drawn again (a page reopened, the chat read again) does not ask
// the Mac for each of them again; a reload asks afresh.
const goneSrcs = new Set<string>();

// goneText: what is said once it has failed; none for a path only named, which then shows nothing.
function Picture({
  src,
  path,
  goneText,
  onOpen,
  onDropped,
}: {
  src: string;
  path: string;
  goneText: string | null;
  onOpen: (src: string) => void;
  onDropped: () => void;
}) {
  const [gone, setGone] = useState(() => goneSrcs.has(src));
  const dropped = gone && goneText === null;
  useEffect(() => {
    if (dropped) onDropped();
  }, [dropped, onDropped]);
  if (dropped) return null;
  if (gone) return <span className="chat-picture gone" data-image={imageKey(path)}>{goneText}</span>;
  return (
    <button
      className="chat-picture"
      aria-label={t.viewImage}
      data-image={imageKey(path)}
      onClick={() => onOpen(src)}
    >
      <img
        src={src}
        alt=""
        onError={() => {
          goneSrcs.add(src);
          setGone(true);
        }}
      />
    </button>
  );
}

export function Viewer({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="image-viewer"
      role="dialog"
      aria-label={t.image}
      onClick={onClose}
    >
      <img src={src} alt="" />
      <button className="viewer-close" aria-label={t.close} onClick={onClose}>
        <IconClose />
      </button>
    </div>
  );
}

export type Opener = (src: string) => void;

// Pictures sent together as one block: full rows of equal squares, two across for two or four, three across
// for more, so no row is left with one hanging under the others.
const picturesAcross = (n: number) => (n === 1 ? 1 : n === 2 || n === 4 ? 2 : 3);

// read: Claude read them, so they were there once.
export function Pictures(props: { sessionId: string; side: 'mine' | 'theirs'; paths: string[]; read?: boolean; onOpen: Opener }) {
  const { sessionId, onOpen } = props;
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const drop = useCallback((path: string) => setDropped((d) => (d.has(path) ? d : new Set(d).add(path))), []);
  const paths = props.paths.filter((p) => !dropped.has(p));
  if (!paths.length) return null;
  return (
    <div className={`chat-pictures ${props.side}${paths.length === 1 ? ' single' : ''}`} style={{ '--across': picturesAcross(paths.length) } as CSSProperties}>
      {paths.map((p) => (
        <Picture key={p} src={imageSrc(sessionId, p)} path={p} goneText={goneText(p, !!props.read)} onOpen={onOpen} onDropped={() => drop(p)} />
      ))}
    </div>
  );
}

// Videos and files sent with a message, by their names: what they hold is on the Mac, for Claude.
export function Files({ files }: { files: SentFile[] }) {
  if (!files.length) return null;
  return (
    <div className="sent-files">
      {files.map((f) => (
        <div key={f.path} className="sent-file">
          {f.video ? <IconPlay /> : <IconDoc />}
          <MiddleName name={f.name} />
        </div>
      ))}
    </div>
  );
}
