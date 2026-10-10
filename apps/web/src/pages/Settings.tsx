import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { deviceLabel, timeAgo } from '@workoffdesk/client/model/format';
import type { Listed } from '@workoffdesk/client/base/listed';
import { ActionSheet } from '../components/ActionSheet';
import { ConfirmButton } from '../components/ConfirmButton';
import { IconCheck, IconForward } from '../icons';
import { PageHeader } from '../components/PageHeader';
import { disablePush, enablePush, pushState, type PushState } from '../push';
import { navigate } from '../router';
import { snippets } from '../platform';
import { getTextSize, setTextSize, TEXT_MAX, TEXT_MIN, TEXT_STEP } from '../textSize';
import { languageChoice, setTheme, themeChoice } from '../looks';
import { t } from '@workoffdesk/i18n';
import { useLooks, useSignIns } from '@workoffdesk/react/settings';

declare const __RELEASE__: string;


function TextSize() {
  const [size, setSize] = useState(getTextSize);
  const change = (n: number) => {
    setSize(n);
    setTextSize(n);
  };
  return (
    <section className="section">
      <h2>{t.textSize}</h2>
      <div className="group">
        <div className="row">
          <div className="row-main">
            <strong>{t.wholeApp}</strong>
            <span>{t.thisDeviceOnly}</span>
          </div>
          <div className="stepper">
            <button className="btn small" aria-label={t.smaller} disabled={size <= TEXT_MIN} onClick={() => change(size - TEXT_STEP)}>
              A−
            </button>
            <output role="status" aria-label={t.textSize}>{size}%</output>
            <button className="btn small" aria-label={t.larger} disabled={size >= TEXT_MAX} onClick={() => change(size + TEXT_STEP)}>
              A+
            </button>
          </div>
        </div>
        <div className="row text-preview">{t.textPreview}</div>
      </div>
    </section>
  );
}

// The colours and the page's language, each this device's own and following it until chosen: a row that says
// which, and opens the choices when tapped.
function Looks() {
  const { colours, themes, pickTheme, language, languages, pickLanguage } = useLooks({ themeChoice, setTheme, languageChoice, restart: () => location.reload() });
  return (
    <section className="section">
      <h2>{t.appearance}</h2>
      <div className="group">
        <ChoiceRow label={t.theme} names={themes} value={colours} onPick={pickTheme} />
        <ChoiceRow label={t.language} note={t.languageRestarts} names={languages} value={language} onPick={pickLanguage} />
      </div>
    </section>
  );
}

// The row opens the card the phone's sheet is: the row's name, what to know before picking, the choices.
function ChoiceRow<T extends string>(props: { label: string; note?: string; names: Record<T, string>; value: T; onPick: (v: T) => void }) {
  const [open, setOpen] = useState(false);
  const options = Object.keys(props.names) as T[];
  return (
    <>
      <button className="row row-link" onClick={() => setOpen(true)}>
        <div className="row-main">
          <strong>{props.label}</strong>
        </div>
        <span className="row-value">{props.names[props.value]}</span>
        <IconForward />
      </button>
      {open && (
        <ActionSheet
          title={props.label}
          message={props.note}
          actions={options.map((o) => ({ label: props.names[o], run: () => props.onPick(o) }))}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// What a list shows before it has rows: that it is on its way, or that it failed, with a retry.
function NotLoaded({ list, retry }: { list: Listed<unknown>; retry: () => void }) {
  if (list.state === 'loading') return <div className="row empty-row">{t.loading}</div>;
  if (list.state === 'loaded') return null;
  return (
    <div className="row">
      <div className="row-main" role="alert">
        <span>{list.error}</span>
      </div>
      <button className="btn small" onClick={retry}>
        {t.tryAgain}
      </button>
    </div>
  );
}

function Snippets() {
  const [text, setText] = useState(snippets.text);
  return (
    <section className="section">
      <h2>{t.snippets}</h2>
      <div className="group">
        <textarea
          className="snippets-input"
          aria-label={t.snippetsLines}
          rows={5}
          placeholder={t.snippetsPlaceholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            snippets.set(e.target.value);
          }}
        />
        <div className="row empty-row">{t.snippetsNote}</div>
      </div>
    </section>
  );
}

// Who is signed in, where, and on which release, as the phone's account row. A browser keeps one login, so
// there is no other account to add or switch to.
function Account() {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    api<{ username?: string }>('/api/me').then(
      (r) => setName(r.username ?? null),
      () => {},
    );
  }, []);
  return (
    <section className="section">
      <h2>{t.account}</h2>
      <div className="group">
        <div className="row">
          <div className="row-main">
            {name && <strong>{name}</strong>}
            {name ? <span>{location.origin}</span> : <strong>{location.origin}</strong>}
            <span>{t.appRelease(__RELEASE__)}</span>
          </div>
          <span className="row-check">
            <IconCheck />
          </span>
        </div>
      </div>
    </section>
  );
}

const PUSH_NOTE: Partial<Record<PushState, string>> = {
  insecure: t.pushInsecure,
  unsupported: t.pushUnsupported,
  denied: t.pushDenied,
};

export function Settings() {
  const { passkeyList, loginList, passkeys, logins, load, retryPasskeys, retryLogins } = useSignIns(api);
  const [push, setPush] = useState<PushState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pushState().then(setPush, () => setPush('unsupported'));
  }, []);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name !== 'NotAllowedError' && name !== 'AbortError') setError(errorText(e, t.failed));
    } finally {
      setBusy(false);
    }
  };

  const addPasskey = () =>
    guard(async () => {
      const options = await api<PublicKeyCredentialCreationOptionsJSON>('/api/auth/passkey/register/options', { method: 'POST', json: {} });
      const response = await startRegistration({ optionsJSON: options });
      await api('/api/auth/passkey/register/verify', { method: 'POST', json: { response } });
      void load();
    });

  const removePasskey = (id: string) =>
    guard(async () => {
      await api(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });
      void load();
    });

  const revoke = (handle: string) =>
    guard(async () => {
      await api(`/api/auth/logins/${handle}`, { method: 'DELETE' });
      void load();
    });

  const togglePush = () => guard(async () => setPush(push === 'on' ? await disablePush() : await enablePush()));

  const logout = () =>
    guard(async () => {
      await api('/api/auth/logout', { method: 'POST' });
      navigate('/login', true);
    });

  return (
    <>
      <PageHeader title={t.settings} onBack={() => navigate('/')} />
      <main className="page">
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <section className="section">
          <div className="group">
            <button className="row row-link" onClick={() => navigate('/mac')}>
              <div className="row-main">
                <strong>{t.thisMac}</strong>
                <span>{t.thisMacSub}</span>
              </div>
              <IconForward />
            </button>
          </div>
        </section>
        <TextSize />
        <Looks />
        <section className="section">
          <h2>{t.pushTitle}</h2>
          <div className="group">
            <div className="row">
              <div className="row-main">
                <strong>{t.pushRemind}</strong>
                <span>{t.pushRemindSub}</span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  aria-label={t.pushTitle}
                  checked={push === 'on'}
                  disabled={busy || (push !== 'on' && push !== 'off')}
                  onChange={togglePush}
                />
                <span />
              </label>
            </div>
            {push && PUSH_NOTE[push] && <div className="row empty-row">{PUSH_NOTE[push]}</div>}
          </div>
        </section>
        <Snippets />
        <Account />

        <section className="section">
          <h2>{t.passkeysTitle}</h2>
          <div className="group">
            <NotLoaded
              list={passkeyList}
              retry={retryPasskeys}
            />
            {passkeys?.length === 0 && <div className="row empty-row">{t.passkeyNone}</div>}
            {passkeys?.map((p) => (
              <div className="row" key={p.id} data-testid="passkey-row">
                <div className="row-main">
                  <strong>{p.name}</strong>
                  <span>
                    {t.addedAgo(timeAgo(p.createdAt))}
                    {p.lastUsedAt ? t.lastUsedAgo(timeAgo(p.lastUsedAt)) : ''}
                  </span>
                </div>
                <ConfirmButton label={t.delete} title={t.confirmDelete} what={p.name} action={t.confirmDelete} destructive disabled={busy} onConfirm={() => removePasskey(p.id)} />
              </div>
            ))}
            {browserSupportsWebAuthn() && (
              <button className="row row-link row-add" disabled={busy} onClick={addPasskey}>
                {t.addPasskey}
              </button>
            )}
          </div>
        </section>

        <section className="section">
          <h2>{t.loggedIn}</h2>
          <div className="group">
            <NotLoaded
              list={loginList}
              retry={retryLogins}
            />
            {logins?.map((l) => (
              <div className="row" key={l.handle} data-testid="login-row">
                <div className="row-main">
                  <strong>
                    {deviceLabel(l.ua)}
                    {l.current && <span className="chip idle">{t.thisDevice}</span>}
                  </strong>
                  <span>
                    {t.loginBy(l.method === 'passkey', timeAgo(l.lastSeen))}
                  </span>
                </div>
                {!l.current && (
                  <ConfirmButton
                    label={t.revoke}
                    title={t.confirmRevoke}
                    what={`${deviceLabel(l.ua)}\n${t.loginBy(l.method === 'passkey', timeAgo(l.lastSeen))}`}
                    action={t.confirmRevoke}
                    destructive
                    disabled={busy}
                    onConfirm={() => revoke(l.handle)}
                  />
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <button className="btn block danger" disabled={busy} onClick={logout}>
            {t.logOut}
          </button>
        </section>
      </main>
    </>
  );
}
