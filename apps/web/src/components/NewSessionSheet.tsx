import { useMemo, useRef, useState } from 'react';
import { agentOf, api, MACHINE, type RecentConversation, type TermSession } from '../api';
import { shortPath, timeAgo } from '@workoffdesk/client/model/format';
import { canPickUp, createSession as create, recentConversations, recentFound, recentNote, type NewAgent } from '@workoffdesk/client/sessions/newSession';
import { into } from '@workoffdesk/client/sessions/projectSearch';
import { IconBack, IconBubble, IconConsole, IconFolder, IconForward, IconHistory } from '../icons';
import { navigate } from '../router';
import { Sheet } from './Sheet';
import { t } from '@workoffdesk/i18n';
import { useFetched } from '@workoffdesk/react/fetched';
import { useNewSession } from '@workoffdesk/react/newSession';
import { useProjectSearch } from '@workoffdesk/react/projectSearch';

const openSession = (s: TermSession) => navigate(`/m/${MACHINE}/s/${s.id}`);

export async function createSession(spec: NewAgent) {
  openSession(await create(api, spec));
}

export function NewSessionSheet({ onClose }: { onClose: () => void }) {
  const { step, setStep, busy, error, agent, codex, pick, run, title } = useNewSession(api, openSession);
  return (
    <Sheet bar title={title} onClose={onClose} onBack={step === 'menu' ? undefined : () => setStep('menu')}>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {step === 'menu' && (
        <>
          <button className="option" disabled={busy} onClick={() => pick('claude')}>
            <span className="opt-icon"><IconBubble /></span>
            <span className="opt-text">
              <span className="opt-title">{t.newInProject}</span>
              <span className="opt-sub">{t.newInProjectSub}</span>
            </span>
          </button>
          <button className="option" disabled={busy} onClick={() => setStep('recent')}>
            <span className="opt-icon"><IconHistory /></span>
            <span className="opt-text">
              <span className="opt-title">{t.resumeRecent}</span>
              <span className="opt-sub">{t.resumeRecentSub}</span>
            </span>
          </button>
          {codex && (
            <>
              <hr className="opt-rule" />
              <button className="option" disabled={busy} onClick={() => pick('codex')}>
                <span className="opt-icon"><IconConsole /></span>
                <span className="opt-text">
                  <span className="opt-title">{t.newCodexInProject}</span>
                  <span className="opt-sub">{t.newCodexInProjectSub}</span>
                </span>
              </button>
            </>
          )}
        </>
      )}
      {step === 'project' && <ProjectPicker busy={busy} onPick={(cwd, title) => run({ kind: agent, cwd, title: title || undefined })} />}
      {step === 'recent' && (
        <RecentPicker
          busy={busy}
          onPick={(r) =>
            navigate(r.openIn ? `/m/${MACHINE}/s/${r.openIn}` : `/${agentOf(r)}/${r.sessionId}`)
          }
        />
      )}
    </Sheet>
  );
}

const loadRecent = () => recentConversations(api);

function ProjectPicker({ busy, onPick }: { busy: boolean; onPick: (cwd: string, title: string) => void }) {
  const { error, found, box, type, chosen } = useProjectSearch(api);
  const [name, setName] = useState('');
  const field = useRef<HTMLInputElement>(null);
  return (
    <>
      <input className="search" aria-label={t.nameOptional} placeholder={t.nameOptionalHint} value={name} onChange={(e) => setName(e.target.value)} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (chosen) onPick(chosen, name);
        }}
        style={{ display: 'flex', gap: 8 }}
      >
        <input
          ref={field}
          className="search"
          aria-label={t.findProject}
          placeholder={t.findProject}
          value={box}
          onChange={(e) => type(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button className="btn small" type="submit" disabled={busy || !chosen}>
          {t.open}
        </button>
      </form>
      {found.path ? found.error && <div className="alert">{found.error}</div> : error && <div className="alert">{error}</div>}
      {!found.rows && !(error && !found.path) && <p className="muted center">{t.loading}</p>}
      {found.rows?.length === 0 && <p className="note">{found.path ? t.noFolders : found.text ? t.notFound(found.text) : t.noProjects}</p>}
      {found.rows?.map((dir) => (
        <div key={dir} className="option-row">
          <button className="option" disabled={busy} onClick={() => onPick(dir, name)}>
            <span className="opt-icon"><IconFolder /></span>
            <span className="opt-text">
              <span className="opt-title">{dir.split('/').pop() || dir}</span>
              <span className="opt-sub">{shortPath(dir)}</span>
            </span>
          </button>
          {found.path && (
            <button
              className="option-in"
              aria-label={t.lookInside(dir.split('/').pop() || dir)}
              onClick={() => {
                type(into(found.text, dir));
                field.current?.focus();
              }}
            >
              <IconForward />
            </button>
          )}
        </div>
      ))}
    </>
  );
}

function RecentPicker({ busy, onPick }: { busy: boolean; onPick: (r: RecentConversation) => void }) {
  const { data, error } = useFetched(loadRecent);
  const [q, setQ] = useState('');
  const [unfolded, setUnfolded] = useState(false);
  const { people, programs } = useMemo(() => recentFound(data ?? [], q), [data, q]);
  const found = people.length + programs.length;
  // What agents started stays folded away, unless a search is looking for it.
  const searching = q.trim() !== '';
  const row = (r: RecentConversation) => (
    <button key={r.sessionId} className="option" disabled={busy || !canPickUp(r)} onClick={() => onPick(r)}>
      <span className="opt-text">
        <span className="opt-title">{r.title}</span>
        <span className="opt-sub">
          {recentNote(r)}
          {timeAgo(r.lastActivity)} · {shortPath(r.cwd)}
        </span>
      </span>
    </button>
  );
  return (
    <>
      <input className="search" placeholder={t.searchTitlePath} value={q} onChange={(e) => setQ(e.target.value)} autoCorrect="off" spellCheck={false} />
      {error && <div className="alert">{error}</div>}
      {!data && !error && <p className="muted center">{t.loading}</p>}
      {data && found === 0 && <p className="note">{q ? t.noMatch : t.noConversations}</p>}
      {people.map(row)}
      {programs.length > 0 && !searching && (
        <button className="fold" aria-expanded={unfolded} onClick={() => setUnfolded(!unfolded)}>
          <IconBack />
          {t.automated(programs.length)}
        </button>
      )}
      {(searching || unfolded) && programs.map(row)}
    </>
  );
}
