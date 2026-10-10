import { ENTER, KEYS } from '@workoffdesk/client/composer/keys';
import { t } from '@workoffdesk/i18n';

// A button pressed while typing: pointerdown + preventDefault keeps the on-screen keyboard and focus where
// they are, so nothing moves under the finger before the tap lands.
export const press = (fn: () => void) => ({
  onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
  onClick: fn,
});

export function KeyBar(props: { ctrlArmed: boolean; onCtrl: () => void; onKey: (seq: string) => void; onPaste: () => void}) {
  return (
    <div className="keybar" role="toolbar" aria-label={t.keys}>
      {KEYS.map((k) =>
        k.seq === null ? (
          <button key={k.label} className={`key ${props.ctrlArmed ? 'armed' : ''}`} aria-pressed={props.ctrlArmed} {...press(props.onCtrl)}>
            Ctrl
          </button>
        ) : (
          <button key={k.label} className="key" aria-label={k.seq === ENTER ? t.enter : k.label} {...press(() => props.onKey(k.seq))}>
            {k.label}
          </button>
        ),
      )}
      <button className="key" {...press(props.onPaste)}>
        {t.paste}
      </button>
    </div>
  );
}
