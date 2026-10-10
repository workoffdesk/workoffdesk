import { errorText, type Api, type TermSession } from '@workoffdesk/client/base/api';
import { agentsOn, createSession, type NewAgent } from '@workoffdesk/client/sessions/newSession';
import { t } from '@workoffdesk/i18n';
import { useMemo, useState } from 'react';
import { useFetched } from './fetched';

export type NewSessionStep = 'menu' | 'project' | 'recent';

// Starting a session from the new-session sheet: its step and title, the agent picked, and the session made,
// handed to `made` to go to. A session that could not be made says why, and the sheet can be used again.
export function useNewSession(api: Api, made: (s: TermSession) => void) {
  const [step, setStep] = useState<NewSessionStep>('menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<NewAgent['kind']>('claude');
  const loadAgents = useMemo(() => () => agentsOn(api), [api]);
  const codex = useFetched(loadAgents).data?.codex;
  const pick = (kind: NewAgent['kind']) => {
    setAgent(kind);
    setStep('project');
  };
  const run = async (spec: NewAgent) => {
    setBusy(true);
    setError(null);
    try {
      made(await createSession(api, spec));
    } catch (e) {
      setError(errorText(e, t.openFailed));
      setBusy(false);
    }
  };
  const title = step === 'menu' ? t.newSession : step === 'project' ? t.pickProject : t.resumeRecent;
  return { step, setStep, busy, error, agent, codex, pick, run, title };
}
