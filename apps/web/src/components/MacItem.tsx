import { dirName, listTime, shortPath } from '@workoffdesk/client/model/format';
import { t } from '@workoffdesk/i18n';
import { agentOf, type RecentConversation } from '../api';
import { IconChat, IconCode } from '../icons';
import { navigate } from '../router';

const link = (to: string) => (e: React.MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  navigate(to);
};

// A Claude or Codex conversation on the Mac, opened to read before picking it up here. One still open in a
// terminal there is drawn as a session here is, with what the agent does in it; the line under it is what was
// said last.
export function MacItem({ r, current }: { r: RecentConversation; current: boolean }) {
  const to = `/${agentOf(r)}/${r.sessionId}`;
  return (
    <a className={current ? 'sess-item mac current' : 'sess-item mac'} aria-current={current ? 'page' : undefined} href={to} onClick={link(to)}>
      <span className={`avatar ${agentOf(r)}${r.onMac ? '' : ' mac'}`} aria-hidden>
        {agentOf(r) === 'codex' ? <IconCode /> : <IconChat />}
        {r.onMac?.status === 'waiting' && <span className="needs-you" />}
        {r.onMac?.status === 'busy' && <span className="busy" />}
      </span>
      <span className="sess-main">
        <span className="sess-top">
          {r.onMac?.status === 'busy' && <span className="sess-badge working">{t.busy}</span>}
          {r.onMac?.status === 'waiting' && <span className="sess-badge waiting">{t.needsYou}</span>}
          {(r.onMac?.terminals ?? 0) > 1 && <span className="sess-badge waiting">{t.openInTerminals(r.onMac!.terminals)}</span>}
          <span className="sess-name">{r.title}</span>
          {r.cwd && <span className="sess-dir">{dirName(r.cwd)}</span>}
          <span className="sess-time">{listTime(r.lastActivity)}</span>
        </span>
        <span className="sess-preview">{r.lastPrompt ?? shortPath(r.cwd ?? '')}</span>
      </span>
    </a>
  );
}
