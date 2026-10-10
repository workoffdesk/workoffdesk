import { missingChecks, NEEDED_CHECKS, type SetupState } from '@workoffdesk/client/mac/setup';
import { t } from '@workoffdesk/i18n';
import { useState } from 'react';
import { CheckRow } from '../../components/CheckRow';
import { Pending } from './common';

export function Checks({ state, reload, next }: { state: SetupState; reload: () => Promise<void>; next: () => void }) {
  const [busy, setBusy] = useState(false);
  const missing = missingChecks(state);
  const needed = state.checks.filter((c) => NEEDED_CHECKS.includes(c.id));
  const again = async () => {
    setBusy(true);
    await reload();
    setBusy(false);
  };
  return (
    <>
      <p className="setup-note">{missing.length ? t.setupChecksFix : t.setupChecksNote}</p>
      <div className="group">
        {[...missing, ...needed.filter((c) => c.ok)].map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </div>
      <div className="setup-actions">
        {missing.length ? (
          <button className="btn primary" onClick={again} disabled={busy}>
            <Pending busy={busy}>{t.setupCheckAgain}</Pending>
          </button>
        ) : (
          <button className="btn primary" onClick={next}>
            {t.setupContinue}
          </button>
        )}
      </div>
    </>
  );
}
