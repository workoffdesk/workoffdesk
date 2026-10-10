import { firstStep, SETUP_STEPS, type SetupState, type SetupStep } from '@workoffdesk/client/mac/setup';
import { t } from '@workoffdesk/i18n';
import { useCallback, useEffect, useState } from 'react';
import { IconCheck } from '../icons';
import { api, callError, post, token } from './setup/common';
import { Checks } from './setup/Checks';
import { Account } from './setup/Account';
import { Address } from './setup/Address';
import { Service } from './setup/Service';
import { ForThePhone, Phone } from './setup/Phone';

// The first install, served by workoffdesk setup --web on this Mac (commands/wizard/server.ts on the server):
// checks, account, address, service, then the phone.

const summaryOf = (step: SetupStep, state: SetupState) =>
  step === 'account' ? state.user : step === 'address' ? state.origin : step === 'service' ? t.macRunning : null;
// The steps a person may go back to; the checks and the service are only ever done again by going on.

const CHANGEABLE: readonly SetupStep[] = ['account', 'address'];

export function Setup() {
  const [state, setState] = useState<SetupState | null>(null);
  const [step, setStep] = useState<SetupStep | null>(null);
  const [error, setError] = useState<string | null>(token ? null : t.setupNoToken);
  const [finished, setFinished] = useState(false);

  const reload = useCallback(async () => {
    try {
      const s = await api<SetupState>('/api/setup/state');
      setState(s);
      setError(null);
      setStep((now) => now ?? firstStep(s));
    } catch (e) {
      setError(callError(e));
    }
  }, []);

  useEffect(() => {
    document.title = t.setupTitle;
    if (token) void reload();
  }, [reload]);

  const finish = async () => {
    try {
      await post('/api/setup/done', {});
      setFinished(true);
    } catch (e) {
      setError(callError(e));
    }
  };

  const at = step ? SETUP_STEPS.indexOf(step) : -1;
  const next = () => setStep(SETUP_STEPS[Math.min(at + 1, SETUP_STEPS.length - 1)]);
  const body = (s: SetupStep, state: SetupState) => {
    if (s === 'checks') return <Checks state={state} reload={reload} next={next} />;
    if (s === 'account') return <Account state={state} reload={reload} next={next} />;
    if (s === 'address') return <Address state={state} reload={reload} next={next} />;
    if (s === 'service') return <Service reload={reload} next={next} />;
    return <Phone state={state} finish={finish} />;
  };

  return (
    <main className="setup">
      <header className="brand setup-brand">
        <img src="/icon.svg" alt="" />
        <h1>{t.setupTitle}</h1>
        <p>{t.setupSub}</p>
      </header>
      {finished ? (
        <div className="setup-done">
          <div className="mac-summary ok" role="status">
            {t.setupFinished}
          </div>
          {state && <ForThePhone state={state} />}
        </div>
      ) : (
        <>
          {error && (
            <div className="alert setup-gap" role="alert">
              {error}
            </div>
          )}
          {!state && !error && (
            <div className="mac-loading">
              <span className="spinner" />
            </div>
          )}
          {state && step && (
            <ol className="setup-steps">
              {SETUP_STEPS.map((s, i) => {
                const place = i < at ? 'done' : i === at ? 'now' : 'later';
                const summary = place === 'done' ? summaryOf(s, state) : null;
                return (
                  <li key={s} className={`setup-step ${place}`} aria-current={place === 'now' ? 'step' : undefined}>
                    <div className="setup-step-head">
                      <span className="setup-num">{place === 'done' ? <IconCheck /> : i + 1}</span>
                      <strong>{t.setupSteps[s]}</strong>
                      {summary && <span className="setup-summary">{summary}</span>}
                      {place === 'done' && CHANGEABLE.includes(s) && (
                        <button className="setup-change" onClick={() => setStep(s)}>
                          {t.setupChange}
                        </button>
                      )}
                    </div>
                    {place === 'now' && <div className="setup-body">{body(s, state)}</div>}
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </main>
  );
}
