import type { Background } from '@workoffdesk/client/journal/journalRows';
import { press } from './KeyBar';
import { t } from '@workoffdesk/i18n';

// The commands Claude runs in the background; Manage opens Claude Code's own /tasks dialog, which stops them.
export function BackgroundBar({ running, onManage }: { running: Background[]; onManage: () => void }) {
  if (!running.length) return null;
  return (
    <div className="chat-bg">
      <details>
        <summary>
          <b>{t.runningInBackground}</b> {t.backgroundRunning(running.length)}
        </summary>
        <ul>
          {running.map((b) => (
            <li key={b.id}>
              <span>{b.label}</span>
              <small>#{b.id}</small>
            </li>
          ))}
        </ul>
      </details>
      <button className="btn small" {...press(onManage)}>
        {t.manageBackground}
      </button>
    </div>
  );
}
