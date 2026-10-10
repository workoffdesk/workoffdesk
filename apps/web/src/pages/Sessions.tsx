import { useEffect, useRef, useState } from 'react';
import { agentOf, api, isAgent, MACHINE, type RecentConversation, type TermSession } from '../api';
import { followMacRecent, keptMacRecent, macShown } from '@workoffdesk/client/sessions/macRecent';
import { NewSessionSheet } from '../components/NewSessionSheet';
import { RenameSheet } from '../components/RenameSheet';
import { dirName, listTime, sessionPreview, shortPath } from '@workoffdesk/client/model/format';
import { folderBeside, listView } from '@workoffdesk/client/sessions/sessionListView';
import { IconGear, IconPlus, IconSearch, IconChat, IconCode, IconTerminal } from '../icons';
import { navigate } from '../router';
import { useSessions } from '../sessions';
import { seen, storage, visibility } from '../platform';
import { t } from '@workoffdesk/i18n';

const link = (to: string) => (e: React.MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  navigate(to);
};

// Claude and Codex conversations people had on this Mac lately and not opened here (macRecent.ts); asked
// again whenever a session here starts or stops following one.
function useMacSessions(sessions: TermSession[] | null): RecentConversation[] {
  const [recent, setRecent] = useState(() => keptMacRecent(storage));
  const followed = (sessions ?? []).flatMap((s) => s.claudeSessionId ?? s.codexThreadId ?? []).sort().join(' ');
  useEffect(() => followMacRecent({ api, storage, visibility }, setRecent), [followed]);
  return macShown(recent, Date.now());
}

// How far a row slides to show its action, and how far a finger moves before it is a swipe, not a tap.
const ACTION_PX = 88;
const SWIPE_PX = 10;

// A row slides left under the finger to show Rename. Opening one row closes the others; a tap on an open
// row closes it rather than opening the session.
function Row({ s, folder, open, current, unread, onOpen, onRename }: { s: TermSession; folder: string | null; open: boolean; current: boolean; unread: boolean; onOpen: (open: boolean) => void; onRename: () => void }) {
  const to = `/m/${MACHINE}/s/${s.id}`;
  const status = isAgent(s.kind) ? s.status : null;
  const drag = useRef<{ x: number; y: number; swiping: boolean; moved: boolean } | null>(null);
  const [dx, setDx] = useState<number | null>(null);
  const base = open ? -ACTION_PX : 0;
  const shift = dx ?? base;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, swiping: false, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.swiping && !d.moved) {
      if (Math.abs(mx) < SWIPE_PX && Math.abs(my) < SWIPE_PX) return;
      d.moved = true;
      // Up and down is scrolling the list.
      if (Math.abs(mx) <= Math.abs(my)) return;
      d.swiping = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (d.swiping) setDx(Math.min(0, Math.max(-ACTION_PX, base + mx)));
  };
  const onPointerUp = () => {
    if (drag.current?.swiping && dx !== null) onOpen(dx < -ACTION_PX / 2);
    setDx(null);
  };
  const onClick = (e: React.MouseEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved || open) {
      e.preventDefault();
      if (open && !d?.moved) onOpen(false);
      return;
    }
    link(to)(e);
  };

  return (
    <div className={`sess-row${dx !== null ? ' dragging' : ''}`}>
      {shift < 0 && (
        <button className="sess-action" onClick={onRename}>
          {t.renameAction}
        </button>
      )}
      <a
        className={current ? 'sess-item current' : 'sess-item'}
        aria-current={current ? 'page' : undefined}
        data-testid="session-card"
        href={to}
        style={shift ? { transform: `translateX(${shift}px)` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setDx(null);
        }}
        onClick={onClick}
        draggable={false}
      >
        <span className={`avatar ${s.kind}`} aria-hidden>
          {s.kind === 'codex' ? <IconCode /> : isAgent(s.kind) ? <IconChat /> : <IconTerminal />}
          {status === 'waiting' && <span className="needs-you" />}
          {status === 'working' && <span className="busy" />}
        </span>
        <span className="sess-main">
          <span className="sess-top">
            {status === 'working' && <span className="sess-badge working">{t.busy}</span>}
            {status === 'waiting' && <span className="sess-badge waiting">{t.needsYou}</span>}
            {unread && status !== 'working' && status !== 'waiting' && <span className="sess-badge unread">{t.unread}</span>}
            <span className="sess-name">{s.title}</span>
            {folder && <span className="sess-dir">{folder}</span>}
            <span className="sess-time">{listTime(s.lastActivity)}</span>
          </span>
          <span className="sess-preview">{sessionPreview(s)}</span>
        </span>
      </a>
    </div>
  );
}

export function Sessions({ current }: { current?: string } = {}) {
  const sessions = useSessions();
  const mac = useMacSessions(sessions);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<TermSession | null>(null);
  const { sorted, shown, groups } = listView(sessions, query);
  const unread = sorted ? seen.unreadOf(sorted) : new Set<string>();
  return (
    <main className="list-page">
      <header className="list-top">
        <a className="icon-btn" href="/settings" aria-label={t.settings} onClick={link('/settings')}>
          <IconGear />
        </a>
        <h1>{t.sessions}</h1>
        <button className="icon-btn" aria-label={t.newSession} onClick={() => setCreating(true)}>
          <IconPlus />
        </button>
      </header>
      {!sorted && <p className="muted center">{t.loading}</p>}
      {sorted?.length === 0 && (
        <div className="empty">
          <IconTerminal />
          <strong>{t.noSessions}</strong>
          <span>{t.noSessionsSub}</span>
        </div>
      )}
      {!!sorted?.length && shown.length === 0 && <p className="muted center">{t.notFound(query.trim())}</p>}
      {shown.length > 0 && (
        <div className="sess-list">
          {groups.map((g) => [
            g.title && (
              <h2 key={`g-${g.cwd}`} className="sess-group">
                {g.title}
                <small>{g.sessions.length}</small>
              </h2>
            ),
            ...g.sessions.map((s) => (
            <Row
              key={s.id}
              s={s}
              folder={folderBeside(s, g.title)}
              unread={unread.has(s.id)}
              open={openId === s.id}
              current={s.id === current}
              onOpen={(open) => setOpenId(open ? s.id : null)}
              onRename={() => {
                setOpenId(null);
                setRenaming(s);
              }}
            />
            )),
          ])}
        </div>
      )}
      {mac.length > 0 && !query.trim() && (
        <div className="sess-list">
          <h2 className="sess-group">
            {t.otherMacSessions}
            <small>{mac.length}</small>
          </h2>
          {mac.map((r) => (
            <a
              key={r.sessionId}
              className={r.sessionId === current ? 'sess-item mac current' : 'sess-item mac'}
              aria-current={r.sessionId === current ? 'page' : undefined}
              href={`/${agentOf(r)}/${r.sessionId}`}
              onClick={link(`/${agentOf(r)}/${r.sessionId}`)}
            >
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
          ))}
          <p className="muted sess-hint">{t.startInTmuxHint}</p>
        </div>
      )}
      {/* At the end, held at the bottom of the screen as the phone's search is. */}
      {!!sorted?.length && (
        <label className="list-search">
          <IconSearch />
          <input type="search" aria-label={t.search} placeholder={t.search} value={query} onChange={(e) => setQuery(e.target.value)} enterKeyHint="search" />
        </label>
      )}
      {creating && <NewSessionSheet onClose={() => setCreating(false)} />}
      {renaming && <RenameSheet session={renaming} onClose={() => setRenaming(null)} />}
    </main>
  );
}
