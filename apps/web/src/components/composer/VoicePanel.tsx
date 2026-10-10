import { useLayoutEffect, useRef } from 'react';
import type { Hold, Zone } from '@workoffdesk/client/composer/talk';
import { t } from '@workoffdesk/i18n';
import { IconClose, IconText } from '../../icons';

const WAVE_BARS = 54;

const HINTS: Record<Zone, string> = {
  send: t.holdSend,
  cancel: t.holdCancel,
  text: t.holdText,
};

export function VoicePanel({ hold }: { hold: Hold }) {
  const heard = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add('voice-held');
    return () => root.classList.remove('voice-held');
  }, []);
  // The newest words stay in sight once there are more than fit.
  useLayoutEffect(() => {
    const h = heard.current;
    if (h) h.scrollTop = h.scrollHeight;
  }, [hold.heard]);
  const target = (zone: Zone, label: string, icon: React.ReactNode) => (
    <div className={hold.zone === zone ? `voice-target ${zone} active` : `voice-target ${zone}`}>
      <span className="voice-target-dot" data-zone={zone} aria-hidden>
        {icon}
      </span>
      {label}
    </div>
  );
  return (
    <div className={`voice-panel zone-${hold.zone}`} role="status">
      {hold.heard && (
        <div className="voice-heard" ref={heard}>
          {hold.heard}
        </div>
      )}
      {!hold.finishing && (
        <div className="voice-targets">
          {target('cancel', t.cancel, <IconClose />)}
          {target('text', t.toText, <IconText />)}
        </div>
      )}
      <div className="voice-hint">{hold.finishing ? t.recognizing : HINTS[hold.zone]}</div>
      {hold.listening ? (
        <div className="wave" aria-hidden>
          {Array.from({ length: WAVE_BARS }, (_, i) => (
            <i key={i} style={{ animationDelay: `${-((i * 137) % 900)}ms` }} />
          ))}
        </div>
      ) : (
        <div className="spinner" aria-label={t.openingMic} />
      )}
    </div>
  );
}
