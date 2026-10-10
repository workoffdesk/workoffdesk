import type { SetupState } from '@workoffdesk/client/mac/setup';
import { t } from '@workoffdesk/i18n';
import { useState } from 'react';
import { CheckRow } from '../../components/CheckRow';

// The address as a code for the phone's camera, which stays on the page after setup has ended.
export function ForThePhone({ state }: { state: SetupState }) {
  return (
    <>
      {state.qr && (
        // The server draws it from the address it keeps; nothing from the page goes into it.
        <div className="setup-qr" dangerouslySetInnerHTML={{ __html: state.qr }} />
      )}
      <p className="setup-origin">{state.origin}</p>
      {state.user && <p className="setup-note centered">{t.setupPhoneNote(state.user)}</p>}
    </>
  );
}

export function Phone({ state, finish }: { state: SetupState; finish: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const failed = state.checks.filter((c) => !c.ok);
  return (
    <>
      <ForThePhone state={state} />
      <div className={`mac-summary ${failed.length ? 'bad' : 'ok'}`}>{failed.length ? t.macProblemCount(failed.length) : t.macAllGood}</div>
      {failed.length > 0 && (
        <div className="group">
          {failed.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </div>
      )}
      <div className="setup-actions">
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await finish();
            setBusy(false);
          }}
        >
          {t.setupFinish}
        </button>
      </div>
    </>
  );
}
