import type { Api } from '@workoffdesk/client/base/api';
import { byDay, createMacHistory } from '@workoffdesk/client/sessions/macHistory';
import { useEffect, useMemo } from 'react';
import { useStore } from './store';

// Every conversation on the Mac, held while its page is shown, under the day each happened.
export function useMacHistory(api: Api) {
  const history = useMemo(() => createMacHistory(api), [api]);
  useEffect(() => history.hold(), [history]);
  const state = useStore(history);
  const days = useMemo(() => byDay(state.rows), [state.rows]);
  return { history, ...state, days };
}
