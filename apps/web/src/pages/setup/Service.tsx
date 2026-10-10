import { t } from '@workoffdesk/i18n';
import { useState } from 'react';
import { callError, post } from './common';

export function Service({ reload, next }: { reload: () => Promise<void>; next: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ ok: boolean; message: string }>('/api/setup/service', {});
      await reload();
      if (r.ok) next();
      else setError(r.message);
    } catch (err) {
      setError(callError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="setup-note">{t.setupServiceNote}</p>
      {busy && (
        <div className="setup-busy" role="status">
          <span className="spinner small" />
          {t.setupInstalling}
        </div>
      )}
      {error && (
        <div className="alert setup-pre" role="alert">
          {error}
        </div>
      )}
      <div className="setup-actions">
        <button className="btn primary" onClick={install} disabled={busy}>
          {error ? t.tryAgain : t.setupInstall}
        </button>
      </div>
    </>
  );
}
