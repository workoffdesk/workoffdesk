import { effortKeys, scrollsInParts, SCROLL_DOWN, SCROLL_UP } from '@workoffdesk/client/chat/panel';
import { effortName, panelName, type Panel } from '@workoffdesk/client/model/chat';
import { press } from '../KeyBar';
import { t } from '@workoffdesk/i18n';
import { useAgentName } from '@workoffdesk/react/agentName';
import { TasksPanel } from './TasksPanel';

// Typing goes into a panel while it is open, so the chat shows it and closes it instead, with the key bar's Esc.
export function PanelCard(props: { panel: Panel; onKey: (data: string) => boolean; onScreen: () => void; onDone: () => void }) {
  const who = useAgentName();
  const { usage, effort, btw, tasks, task, body } = props.panel;
  const name = btw ? t.btwAsked : t.agentOpened(who, panelName(props.panel));
  const send = (keys: string) => props.onKey(keys) && props.onDone();
  const setEffort = (to: number) => effort && send(effortKeys(effort, to));
  const scrolls = scrollsInParts(props.panel);
  return (
    <div className="chat-choice chat-panel" role="group" aria-label={name}>
      <div className="panel-title">{name}</div>
      {usage && (
        <div className="panel-usages">
          <span className="panel-usage">{usage.session === null ? t.fiveHourUnseen : t.fiveHourUsed(usage.session)}</span>
          <span className="panel-usage">{usage.week === null ? t.weekUnseen : t.weekUsed(usage.week)}</span>
        </div>
      )}
      {effort ? (
        <div className="effort-levels">
          {effort.levels.map((level, i) => (
            <button key={level} className="choice-opt" aria-current={i === effort.at} {...press(() => setEffort(i))}>
              <strong>{effortName(level)}</strong>
            </button>
          ))}
        </div>
      ) : btw ? (
        <>
          <div className="btw-question">{btw.question}</div>
          {body && <div className="btw-answer">{body}</div>}
        </>
      ) : tasks || task ? (
        <TasksPanel panel={props.panel} send={send} />
      ) : (
        body && <pre className="panel-body">{body}</pre>
      )}
      {effort && <div className="chat-note">{t.effortHint}</div>}
      <div className="choice-actions">
        {scrolls && (
          <button className="btn small" {...press(() => send(SCROLL_UP))}>
            {t.scrollUp}
          </button>
        )}
        {scrolls && (
          <button className="btn small" {...press(() => send(SCROLL_DOWN))}>
            {t.scrollDown}
          </button>
        )}
        <button className="btn small" {...press(() => send('\x1b'))}>
          {t.closeEsc}
        </button>
        <button className="btn small" onClick={props.onScreen}>
          {t.showScreen}
        </button>
      </div>
    </div>
  );
}
