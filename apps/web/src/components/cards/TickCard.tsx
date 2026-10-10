import { press } from '../KeyBar';
import { CardActions, useTicks, type CardProps } from './common';
import { t } from '@workoffdesk/i18n';
import { useAgentName } from '@workoffdesk/react/agentName';

// A question that takes several answers: ticks stay in the card until it is sent, all at once.
export function TickCard(props: CardProps) {
  const who = useAgentName();
  const { busy, note, ticked, flip, sendTicks } = useTicks(props);
  const { options, submit } = props.choices;
  return (
    <div className="chat-choice" role="group" aria-label={t.agentAsks(who)}>
      {props.choices.context && <div className="choice-context">{props.choices.context}</div>}
      {options.map((o, i) =>
        o.typed ? null : (
          <button
            key={`${i}-${o.label}`}
            className="choice-opt tick"
            role="checkbox"
            aria-checked={ticked.has(i)}
            disabled={busy}
            {...press(() => flip(i))}
          >
            <i aria-hidden="true">{ticked.has(i) ? '✓' : ''}</i>
            <div>
              <strong>{o.label}</strong>
              {o.detail && <span>{o.detail}</span>}
            </div>
          </button>
        ),
      )}
      {options.some((o) => o.typed) && <div className="chat-note">{t.typedHint}</div>}
      {note && <div className="chat-note">{note}</div>}
      <button className="btn primary" disabled={busy} {...press(sendTicks)}>
        {submit === 'Next' ? t.nextQuestion : t.submit} {t.ticked(ticked.size)}
      </button>
      <CardActions {...props} busy={busy} />
    </div>
  );
}
