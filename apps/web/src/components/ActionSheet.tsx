import { t } from '@workoffdesk/i18n';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export type Action = { label: string; run: () => void; destructive?: boolean };

// The phone's choices as iOS draws them: one card in the middle of the dimmed page, each choice a pill and
// Cancel the last. A destructive choice is red, and picking it is its confirmation. A choice runs before the card
// closes. `side`: one choice beside Cancel, as an alert asks to be sure, its words at the start of the card.
// `cancel`: what Cancel says.
export function ActionSheet(props: { title?: string; message?: string; actions: Action[]; side?: boolean; cancel?: string; onClose: () => void }) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const cancel = (
    <button className="action" onClick={onClose} autoFocus>
      {props.cancel ?? t.cancel}
    </button>
  );
  const choices = props.actions.map((a) => (
    <button
      key={a.label}
      className={a.destructive ? 'action danger' : 'action'}
      onClick={() => {
        a.run();
        onClose();
      }}
    >
      {a.label}
    </button>
  ));
  return createPortal(
    <>
      <div className="scrim soft" onClick={onClose} />
      <div className="action-sheet">
        <div className={props.side ? 'action-card alert' : 'action-card'} role="dialog" aria-modal="true" aria-label={props.title}>
          {(props.title || props.message) && (
            <div className="action-head">
              {props.title && <div className="action-title">{props.title}</div>}
              {props.message && <div className="action-message">{props.message}</div>}
            </div>
          )}
          {props.side ? (
            <div className="action-row">
              {cancel}
              {choices}
            </div>
          ) : (
            <>
              {choices}
              {cancel}
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
