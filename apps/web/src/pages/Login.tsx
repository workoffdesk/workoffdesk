import { startAuthentication, browserSupportsWebAuthn, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { loginErrorText } from '@workoffdesk/client/base/login';
import { forgetChats } from '../chatStore';
import { IconFace } from '../icons';
import { navigate } from '../router';
import { chatFeeds, journals } from '../platform';
import { forgetSessions } from '../sessions';
import { t } from '@workoffdesk/i18n';

function afterLogin() {
  const next = new URLSearchParams(location.search).get('next');
  navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', true);
}

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Every way out of a login ends here; what was kept for it goes with it.
  useEffect(() => {
    forgetSessions();
    chatFeeds.forget();
    void forgetChats();
    void journals.forget();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/password', { method: 'POST', json: { username, password } });
      afterLogin();
    } catch (err) {
      setError(loginErrorText(err));
      setBusy(false);
    }
  };

  const passkey = async () => {
    setBusy(true);
    setError(null);
    try {
      const options = await api<PublicKeyCredentialRequestOptionsJSON>('/api/auth/passkey/login/options', { method: 'POST', json: {} });
      const response = await startAuthentication({ optionsJSON: options });
      await api('/api/auth/passkey/login/verify', { method: 'POST', json: { response } });
      afterLogin();
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'NotAllowedError' || name === 'AbortError') setError(null);
      else if (err instanceof ApiError && err.status === 401)
        setError(t.unknownPasskey);
      else setError(loginErrorText(err));
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <div className="login-card">
        <div className="brand">
          <img src="/icon.svg" alt="" />
          <h1>WorkOffDesk</h1>
          <p>{t.tagline}</p>
        </div>
        {browserSupportsWebAuthn() && (
          <>
            <button className="btn primary block" onClick={passkey} disabled={busy}>
              <IconFace />
              {t.faceId}
            </button>
            <div className="divider">{t.orPassword}</div>
          </>
        )}
        <form onSubmit={submit} style={{ display: 'contents' }}>
          <label className="field">
            {t.username}
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username webauthn"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </label>
          <label className="field">
            {t.password}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          <button className="btn primary block" type="submit" disabled={busy || !username || !password}>
            {t.login}
          </button>
        </form>
      </div>
    </main>
  );
}
