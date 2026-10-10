import type { SetupState } from '@workoffdesk/client/mac/setup';
import { t } from '@workoffdesk/i18n';
import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD, Pending, callError, post } from './common';

export function Account({ state, reload, next }: { state: SetupState; reload: () => Promise<void>; next: () => void }) {
  const [replacing, setReplacing] = useState(!state.user);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!replacing && state.user) {
    return (
      <>
        <p className="setup-note">{t.setupAccountHave(state.user)}</p>
        <div className="setup-actions">
          <button className="btn primary" onClick={next}>
            {t.setupKeep}
          </button>
          <button className="btn" onClick={() => setReplacing(true)}>
            {t.setupReplace}
          </button>
        </div>
      </>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== again) return setError(t.setupPasswordsDiffer);
    setBusy(true);
    setError(null);
    try {
      await post('/api/setup/account', { username, password });
      await reload();
      next();
    } catch (err) {
      setError(callError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="setup-form" onSubmit={submit}>
      <p className="setup-note">{t.setupAccountNote}</p>
      {state.user && <p className="setup-warn">{t.setupReplaceNote}</p>}
      <label className="field">
        {t.username}
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
      </label>
      <label className="field">
        {t.password}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={MIN_PASSWORD} required />
        <small>{t.setupPasswordRule(MIN_PASSWORD)}</small>
      </label>
      <label className="field">
        {t.setupPasswordAgain}
        <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
      </label>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <div className="setup-actions">
        <button className="btn primary" type="submit" disabled={busy}>
          <Pending busy={busy}>{t.setupSaveAccount}</Pending>
        </button>
        {state.user && (
          <button className="btn" type="button" onClick={() => setReplacing(false)}>
            {t.cancel}
          </button>
        )}
      </div>
    </form>
  );
}
