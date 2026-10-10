import { useState } from 'react';
import { press } from '../KeyBar';
import { Reply } from '../turn/Reply';
import { CardActions, useAnswer, type CardProps } from './common';
import { t } from '@workoffdesk/i18n';
import { useAgentName } from '@workoffdesk/react/agentName';

// What Claude asks, one option to take: a click picks it and Submit sends it, so a click that missed is not an
// answer. Writing an answer of one's own is not one yet, so it goes on a click.
export function ChoiceCard(props: CardProps) {
  const who = useAgentName();
  const { busy, note, send } = useAnswer(props.sessionId, props.onDone, props.choices.context);
  const [picked, setPicked] = useState<{ index: number; label: string } | null>(null);
  // An option picked before the options changed is not picked any more.
  const chosen = picked && props.choices.options[picked.index]?.label === picked.label ? picked : null;
  return (
    <div className="chat-choice" role="group" aria-label={t.agentAsks(who)}>
      {props.choices.plan && (
        <div className="choice-plan">
          <div className="chat-plan-head">{t.plan}</div>
          <Reply text={props.choices.plan} />
        </div>
      )}
      {props.choices.context && (
        <div className="choice-context">{props.choices.context}</div>
      )}
      {props.choices.options.map((o, i) => (
        <button
          key={`${i}-${o.label}`}
          className="choice-opt"
          role={o.typed ? undefined : 'radio'}
          aria-checked={o.typed ? undefined : chosen?.index === i}
          disabled={busy}
          {...press(() => (o.typed ? send({ index: i, label: o.label }, null) : setPicked({ index: i, label: o.label })))}
        >
          <strong>{o.typed ? t.writeOwnAnswer : o.label}</strong>
          {o.detail && <span>{o.detail}</span>}
        </button>
      ))}
      {props.choices.options[props.choices.cursor]?.typed && (
        <div className="chat-note">{t.writeBelow}</div>
      )}
      {note && <div className="chat-note">{note}</div>}
      <button className="btn primary" disabled={busy || !chosen} {...press(() => chosen && send(chosen, chosen.label))}>
        {t.submit}
      </button>
      <CardActions {...props} busy={busy} />
    </div>
  );
}
