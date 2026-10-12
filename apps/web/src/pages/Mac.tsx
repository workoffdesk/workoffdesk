import { timeAgo } from '@workoffdesk/client/model/format';
import { opWords, type ClaudeAccounts, type MacOp, type MacReport } from '@workoffdesk/client/mac/macPage';
import { accountBar, accountLine } from '@workoffdesk/client/mac/usage';
import { t } from '@workoffdesk/i18n';
import { useMacPage } from '@workoffdesk/react/macPage';
import { api } from '../api';
import { CheckRow } from '../components/CheckRow';
import { ConfirmButton } from '../components/ConfirmButton';
import { IconCheck, IconForward } from '../icons';
import { PageHeader } from '../components/PageHeader';
import { navigate } from '../router';

// Shown only on a Mac with more than one account: a click on one puts the sessions started next on it, and the open
// sessions on another account can be moved to it.
type AccountsProps = { accounts: ClaudeAccounts; picking: string | null; pick: (id: string) => void; moveAsked: boolean; move: () => void };
function Accounts({ accounts, picking, pick, moveAsked, move }: AccountsProps) {
  return (
    <section className="section">
      <h2>{t.macClaudeAccounts}</h2>
      <div className="group">
        {accounts.accounts.map((a) => {
          const bar = accountBar(a);
          const inUse = a.id === accounts.inUse;
          return (
            <button
              key={a.id}
              className={bar ? 'row row-link barred' : 'row row-link'}
              aria-pressed={inUse}
              disabled={!!bar || inUse || picking !== null}
              onClick={() => pick(a.id)}
            >
              <div className="row-main">
                <strong>{a.email}</strong>
                <span>{accountLine(a)}</span>
              </div>
              {picking === a.id ? (
                <span className="spinner" />
              ) : (
                inUse && (
                  <span className="row-check">
                    <IconCheck />
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>
      <Moves accounts={accounts} moveAsked={moveAsked} disabled={picking !== null} move={move} />
      {!accounts.elsewhere && !accounts.moving && <p className="muted mac-note">{t.macAccountNote}</p>}
    </section>
  );
}

// The open sessions still on another account than the one in use: moving them to it, or the move under way.
function Moves({ accounts, moveAsked, disabled, move }: { accounts: ClaudeAccounts; moveAsked: boolean; disabled: boolean; move: () => void }) {
  const to = accounts.accounts.find((a) => a.id === accounts.inUse)?.email ?? '';
  if (accounts.moving > 0)
    return (
      <div className="mac-move moving" role="status">
        <span className="spinner small" aria-hidden />
        <div className="mac-move-text">
          <strong>{t.macMovingSessions(accounts.moving)}</strong>
          <span>{t.macMovingTo(to)}</span>
        </div>
      </div>
    );
  if (!accounts.elsewhere) return null;
  return (
    <div className="mac-move">
      <div className="mac-move-text">
        <strong>{t.macElsewhere(accounts.elsewhere)}</strong>
        <span>{t.macMoveTo(to)}</span>
      </div>
      <button className="btn primary" disabled={moveAsked || disabled} aria-busy={moveAsked} onClick={move}>
        {moveAsked ? <span className="spinner small" aria-hidden /> : t.macMoveButton}
      </button>
    </div>
  );
}

function Build({ report }: { report: MacReport }) {
  const current = report.releases.find((r) => r.name === report.release);
  const since = current?.activatedAt ? Date.parse(current.activatedAt) : NaN;
  return (
    <section className="section">
      <h2>{t.macVersion}</h2>
      <div className="group">
        <div className="row">
          <div className="row-main">
            <strong>{report.version}</strong>
            {report.build?.commit && <span>{t.macBuiltFrom(report.build.commit.slice(0, 12), report.build.dirty)}</span>}
            {!Number.isNaN(since) && <span>{t.macServingSince(timeAgo(since))}</span>}
          </div>
        </div>
      </div>
      {report.releases.length > 0 && (
        <>
          <h2 className="mac-sub">{t.macReleases}</h2>
          <div className="group">
            {report.releases.map((r) => (
              <div className="row" key={r.name}>
                <div className="row-main">
                  <strong>
                    {r.version || r.name}
                    {r.name === report.release && <span className="chip idle">{t.macRunning}</span>}
                  </strong>
                  <span>
                    {r.name}
                    {r.activatedAt ? ` · ${timeAgo(Date.parse(r.activatedAt))}` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Actions({ report, op, restart, rollback }: { report: MacReport; op: MacOp | null; restart: () => void; rollback: (to: string) => void }) {
  const busy = op?.phase === 'asking' || op?.phase === 'waiting';
  const back = report.releases.find((r) => r.name === report.rollbackTo);
  const backName = back ? back.version || back.name : null;
  return (
    <section className="section">
      <h2>{t.macActions}</h2>
      <div className="group">
        {op && (
          <div className={`row mac-op ${op.phase}`} role="status">
            {busy && <span className="spinner small" />}
            <span>{opWords(op)}</span>
          </div>
        )}
        {!report.managed ? (
          <div className="row empty-row">{t.macNotManaged}</div>
        ) : (
          <>
            <div className="row">
              <div className="row-main">
                <strong>{t.macRestart}</strong>
                <span>{t.macRestartNote}</span>
              </div>
              <ConfirmButton
                className="btn small"
                label={t.macRestartShort}
                title={t.macRestart}
                what={t.macRestartNote}
                action={t.macRestartConfirm}
                disabled={busy}
                onConfirm={restart}
              />
            </div>
            <div className="row">
              {backName && report.rollbackTo ? (
                <>
                  <div className="row-main">
                    <strong>{t.macRollback(backName)}</strong>
                    <span>{report.rollbackTo}</span>
                  </div>
                  <ConfirmButton
                    label={t.macRollbackShort}
                    title={t.macRollback(backName)}
                    what={report.rollbackTo}
                    action={t.macRollbackShort}
                    destructive
                    disabled={busy}
                    onConfirm={() => rollback(report.rollbackTo!)}
                  />
                </>
              ) : (
                <div className="row-main">
                  <span>{t.macNoRollback}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export function Mac() {
  const { page, report, problems, error, op, accounts, picking, moveAsked, failed } = useMacPage(api);
  return (
    <>
      <PageHeader title={t.thisMac} onBack={() => navigate('/settings')} />
      <main className="page">
        {error && (
          <div className="alert" role="alert">
            {error}{' '}
            <button className="btn small" onClick={page.load}>
              {t.tryAgain}
            </button>
          </div>
        )}
        {!report && !error && (
          <div className="mac-loading">
            <span className="spinner" />
          </div>
        )}
        {report && (
          <>
            <div className={`mac-summary ${failed ? 'bad' : 'ok'}`} data-testid="mac-summary">
              {failed ? t.macProblemCount(failed) : t.macAllGood}
            </div>
            {accounts && accounts.accounts.length >= 2 && <Accounts accounts={accounts} picking={picking} pick={page.pick} moveAsked={moveAsked} move={page.move} />}
            <section className="section">
              <h2>{t.macChecks}</h2>
              <div className="group">
                {report.checks
                  .filter((c) => !c.ok)
                  .map((c) => (
                    <CheckRow key={c.id} check={c} />
                  ))}
                <details className="mac-passed">
                  <summary>
                    <span className="mac-dot ok" />
                    <span>{failed ? t.macPassed(report.checks.length - failed) : t.macAllPassed(report.checks.length)}</span>
                    <IconForward />
                  </summary>
                  {report.checks
                    .filter((c) => c.ok)
                    .map((c) => (
                      <CheckRow key={c.id} check={c} />
                    ))}
                </details>
              </div>
            </section>
            <Actions report={report} op={op} restart={page.restart} rollback={page.rollback} />
            <Build report={report} />
          </>
        )}
        {problems && (
          <section className="section">
            <h2>{t.macProblems}</h2>
            <div className="group">
              {problems.length === 0 && <div className="row empty-row">{t.macNoProblems}</div>}
              {problems.map((p, i) => (
                <details className="mac-problem" key={`${p.at}-${i}`}>
                  <summary>
                    <span className={`mac-level ${p.level}`}>{p.level}</span>
                    <span className="mac-problem-msg">{p.msg || '—'}</span>
                    {(p.count ?? 1) > 1 && <span className="mac-problem-count">×{p.count}</span>}
                    <time>{timeAgo(Date.parse(p.at))}</time>
                  </summary>
                  <pre>{p.detail}</pre>
                </details>
              ))}
            </div>
            <p className="muted mac-note">{t.macLogNote}</p>
          </section>
        )}
      </main>
    </>
  );
}
