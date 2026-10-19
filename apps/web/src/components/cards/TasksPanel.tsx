import { taskKeys, TASK_BACK, TASK_STOP } from '@workoffdesk/client/chat/panel';
import type { Panel } from '@workoffdesk/client/model/chat';
import { t } from '@workoffdesk/i18n';
import { press } from '../KeyBar';

const said = (words: Record<string, string>, w: string) => words[w] ?? w;

// Claude Code's /tasks: its list, each task with its own buttons, or one task opened, with the way back.
export function TasksPanel({ panel, send }: { panel: Panel; send: (keys: string) => void }) {
  const { tasks, task } = panel;
  if (tasks) {
    if (!tasks.rows.length) return <div className="chat-note">{t.tasksNone}</div>;
    return (
      <ul className="task-rows">
        {tasks.rows.map((row, i) => (
          <li key={`${i}-${row.label}`} className="task-row">
            <span className="task-label">{row.label}</span>
            {row.status && <small>{said(t.taskStatus, row.status)}</small>}
            <span className="task-buttons">
              <button className="btn small" {...press(() => send(taskKeys(tasks, i, 'view')))}>
                {t.taskOutput}
              </button>
              <button className="btn small danger" {...press(() => send(taskKeys(tasks, i, 'stop')))}>
                {t.stop}
              </button>
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (!task) return null;
  return (
    <div className="task-open">
      <dl>
        {task.fields.map((f) => (
          <div key={f.name}>
            <dt>{said(t.taskFields, f.name)}</dt>
            <dd className={f.name === 'Command' ? 'mono' : undefined}>{f.name === 'Status' ? said(t.taskStatus, f.value) : f.value}</dd>
          </div>
        ))}
      </dl>
      {task.output && <pre className="panel-body">{task.output}</pre>}
      <span className="task-buttons">
        <button className="btn small" {...press(() => send(TASK_BACK))}>
          {t.taskBack}
        </button>
        <button className="btn small danger" {...press(() => send(TASK_STOP))}>
          {t.stop}
        </button>
      </span>
    </div>
  );
}
