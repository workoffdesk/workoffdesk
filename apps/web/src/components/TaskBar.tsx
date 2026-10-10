import type { Task } from '@workoffdesk/client/journal/journalRows';
import { t } from '@workoffdesk/i18n';

const MARK: Record<string, string> = { completed: '✓', in_progress: '●' };

// Claude's task list while any of it is left: how far along, what it is on now, and the whole list when opened.
export function TaskBar({ tasks }: { tasks: Task[] }) {
  const done = tasks.filter((t) => t.status === 'completed').length;
  if (!tasks.length || done === tasks.length) return null;
  const now = tasks.find((t) => t.status === 'in_progress');
  return (
    <details className="chat-tasks">
      <summary>
        <span className="tasks-count">
          {t.tasks(done, tasks.length)}
        </span>
        <span className="tasks-now">{now ? t.taskNow(now.subject) : t.taskNotStarted}</span>
      </summary>
      <ul>
        {tasks.map((t, i) => (
          <li key={i} className={t.status}>
            <span className="tasks-mark">{MARK[t.status] ?? '○'}</span>
            {t.subject}
          </li>
        ))}
      </ul>
    </details>
  );
}
