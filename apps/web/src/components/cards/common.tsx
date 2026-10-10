import { answerHooks, type CardProps } from '@workoffdesk/react/answers';
import { answers } from '../../platform';
import { api } from '../../api';
import { press } from '../KeyBar';
import { t } from '@workoffdesk/i18n';

export type { CardProps };
export const { useAnswer, useAskAnswer, useTicks } = answerHooks({ api, answers });

export function CardActions(props: CardProps & { busy: boolean }) {
  return (
    <div className="choice-actions">
      <button className="btn small" disabled={props.busy} {...press(() => props.onKey('\x1b'))}>
        {t.escCancel}
      </button>
      <button className="btn small" onClick={props.onScreen}>
        {t.showScreen}
      </button>
    </div>
  );
}
