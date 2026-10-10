import type { SetupAddress, SetupState } from '@workoffdesk/client/mac/setup';
import { t } from '@workoffdesk/i18n';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Pending, callError, post } from './common';

type Kind = SetupAddress['kind'];

export function Address({ state, reload, next }: { state: SetupState; reload: () => Promise<void>; next: () => void }) {
  const { tailscale, cloudflared } = state.remote;
  const tunnels = cloudflared?.tunnels ?? [];
  const [kind, setKind] = useState<Kind>(tailscale?.running ? 'tailscale' : tunnels.length ? 'cloudflare' : 'other');
  const [tunnel, setTunnel] = useState(tunnels[0] ?? '');
  const [hostname, setHostname] = useState('');
  const [origin, setOrigin] = useState('https://');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'check' | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: SetupAddress = kind === 'tailscale' ? { kind } : kind === 'cloudflare' ? { kind, tunnel, hostname: hostname.trim() } : { kind, origin: origin.trim() };
    setBusy('save');
    setError(null);
    try {
      await post('/api/setup/address', body);
      await reload();
      next();
    } catch (err) {
      setError(callError(err));
    } finally {
      setBusy(null);
    }
  };
  const checkAgain = async () => {
    setBusy('check');
    await reload();
    setBusy(null);
  };

  const choice = (k: Kind, title: string, sub: string, enabled: boolean, extra?: ReactNode) => (
    <label className={`setup-choice${kind === k ? ' chosen' : ''}${enabled ? '' : ' off'}`}>
      <input type="radio" name="kind" checked={kind === k} disabled={!enabled} onChange={() => setKind(k)} />
      <span className="setup-choice-text">
        <strong>{title}</strong>
        <span>{sub}</span>
        {kind === k && extra}
      </span>
    </label>
  );

  return (
    <form className="setup-form" onSubmit={submit}>
      <p className="setup-note">{t.setupAddressNote}</p>
      {state.origin && (
        <div className="setup-now">
          <span>{t.setupAddressNow(state.origin)}</span>
          <button className="btn small" type="button" onClick={next}>
            {t.setupKeep}
          </button>
        </div>
      )}
      <div className="setup-choices">
        {tailscale &&
          choice('tailscale', t.setupTailscale, tailscale.running ? t.setupTailscaleUse(tailscale.dnsName) : t.setupTailscaleDown, tailscale.running)}
        {tunnels.length > 0 &&
          choice(
            'cloudflare',
            t.setupCloudflare,
            t.setupCloudflareNote,
            true,
            <span className="setup-choice-fields">
              <label className="field">
                {t.setupTunnel}
                <select value={tunnel} onChange={(e) => setTunnel(e.target.value)}>
                  {tunnels.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t.setupHostname}
                <input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="workoffdesk.example.com" autoCapitalize="none" spellCheck={false} required />
              </label>
            </span>,
          )}
        {choice(
          'other',
          t.setupOther,
          t.setupOtherNote(state.port),
          true,
          <span className="setup-choice-fields">
            <label className="field">
              <input value={origin} onChange={(e) => setOrigin(e.target.value)} type="url" autoCapitalize="none" spellCheck={false} required aria-label={t.setupOther} />
            </label>
          </span>,
        )}
      </div>
      {!tailscale?.running && !tunnels.length && <p className="setup-note">{t.setupNoWayIn}</p>}
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <div className="setup-actions">
        <button className="btn primary" type="submit" disabled={busy !== null}>
          <Pending busy={busy === 'save'}>{t.setupUseAddress}</Pending>
        </button>
        <button className="btn" type="button" onClick={checkAgain} disabled={busy !== null}>
          <Pending busy={busy === 'check'}>{t.setupCheckAgain}</Pending>
        </button>
      </div>
    </form>
  );
}
