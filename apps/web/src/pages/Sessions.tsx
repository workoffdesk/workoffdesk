import { useEffect, useRef, useState } from 'react';
import { api, errorText, isAgent, MACHINE, type RecentConversation, type TermSession } from '../api';
import { leaveSession } from '@workoffdesk/client/sessions/leave';
import { ActionSheet, type Action } from '../components/ActionSheet';
import { MacItem } from '../components/MacItem';
import { followMacRecent, keptMacRecent, macShown } from '@workoffdesk/client/sessions/macRecent';
import { NewSessionSheet } from '../components/NewSessionSheet';
import { RenameSheet } from '../components/RenameSheet';
import { listTime, sessionPreview, shortPath } from '@workoffdesk/client/model/format';
import { folderBeside, listView } from '@workoffdesk/client/sessions/sessionListView';
import { IconGear, IconHistory, IconPlus, IconSearch, IconChat, IconCode, IconTerminal } from '../icons';
import { navigate } from '../router';
import { useSessions } from '../sessions';
import { seen, sessionList, storage, visibility } from '../platform';
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
  return macShown(recent, Date.now(), sessions ?? []);
}

// How wide each action a row slides to show is, and how far a finger moves before it is a swipe, not a tap.
const ACTION_PX = 88;
const SWIPE_PX = 10;

// A row slides left under the finger to show its actions, as a long press shows them on the phone. Opening one
// row closes the others; a tap on an open row closes it rather than opening the session. A past session is
// drawn as a conversation on the Mac is, with no status: nothing runs in it.
function Row({ s, folder, open, current, unread, onOpen, actions }: { s: TermSession; folder: string | null; open: boolean; current: boolean; unread: boolean; onOpen: (open: boolean) => void; actions: Action[] }) {
  const to = `/m/${MACHINE}/s/${s.id}`;
  const status = isAgent(s.kind) && !s.past ? s.status : null;
  const drag = useRef<{ x: number; y: number; swiping: boolean; moved: boolean } | null>(null);
  const [dx, setDx] = useState<number | null>(null);
  const width = actions.length * ACTION_PX;
  const base = open ? -width : 0;
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
    if (d.swiping) setDx(Math.min(0, Math.max(-width, base + mx)));
  };
  const onPointerUp = () => {
    if (drag.current?.swiping && dx !== null) onOpen(dx < -width / 2);
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
        <span className="sess-actions" style={{ width }}>
          {actions.map((a) => (
            <button key={a.label} className={a.destructive ? 'sess-action danger' : 'sess-action'} onClick={a.run}>
              {a.label}
            </button>
          ))}
        </span>
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
        <span className={`avatar ${s.kind}${s.past ? ' mac' : ''}`} aria-hidden>
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
          <span className="sess-preview">{s.past ? s.lastReply || shortPath(s.cwd) : sessionPreview(s)}</span>
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
  const [deleting, setDeleting] = useState<TermSession | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { sorted, shown, groups } = listView(sessions, query);
  const unread = sorted ? seen.unreadOf(sorted) : new Set<string>();
  const leave = (s: TermSession) => {
    setProblem(null);
    leaveSession(api, sessionList, s).catch((e: unknown) => setProblem(errorText(e, s.past ? t.deleteFailed : t.notEnded, s.past ? t.deleteFailed : t.endFailed)));
  };
  const actions = (s: TermSession): Action[] => {
    const then = (run: () => void) => () => {
      setOpenId(null);
      run();
    };
    return [
      { label: t.renameAction, run: then(() => setRenaming(s)) },
      s.past ? { label: t.delete, destructive: true, run: then(() => setDeleting(s)) } : { label: t.endSession, destructive: true, run: then(() => leave(s)) },
    ];
  };
  return (
    <main className="list-page">
      <header className="list-top">
        <a className="icon-btn" href="/settings" aria-label={t.settings} onClick={link('/settings')}>
          <IconGear />
        </a>
        <h1>{t.sessions}</h1>
        <span className="list-top-right">
          <a className="icon-btn" href="/conversations" aria-label={t.conversationsOnMac} onClick={link('/conversations')}>
            <IconHistory />
          </a>
          <button className="icon-btn" aria-label={t.newSession} onClick={() => setCreating(true)}>
            <IconPlus />
          </button>
        </span>
      </header>
      {problem && <p className="alert list-problem">{problem}</p>}
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
              actions={actions(s)}
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
            <MacItem key={r.sessionId} r={r} current={r.sessionId === current} />
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
      {renaming && <RenameSheet session={renaming} onClose={() => setRenaming(null)} onFailed={setProblem} />}
      {deleting && (
        <ActionSheet
          title={t.deleteSessionTitle}
          message={t.deleteSessionSub}
          side
          actions={[{ label: t.delete, destructive: true, run: () => leave(deleting) }]}
          onClose={() => setDeleting(null)}
        />
      )}
    </main>
  );
}
