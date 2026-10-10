import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconBack, IconClose } from '../icons';
import { t } from '@workoffdesk/i18n';

// The phone's page sheet: from just under the top of the screen to its bottom, its title and the round ✕
// at the top. `bar`: its title in the middle of a bar of its own above a page, as the phone's new-session
// screen has it. `head`: buttons beside the ✕.
// Put on the body, so no container that clips or scrolls (the key bar) can cut it off.
export function Sheet(props: {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  head?: ReactNode;
  bar?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const back = props.onBack && (
    <button className="icon-btn" onClick={props.onBack} aria-label={t.back}>
      <IconBack />
    </button>
  );
  return createPortal(
    <>
      <div className="scrim" onClick={props.onClose} />
      <div
        className={['sheet', props.bar && 'bar', props.className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sheet-head">
          {props.bar ? <span className="sheet-side">{back}</span> : back}
          <h2 id={titleId}>{props.title}</h2>
          {props.head}
          <button className="sheet-close" onClick={props.onClose} aria-label={t.close}>
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">{props.children}</div>
      </div>
    </>,
    document.body,
  );
}
