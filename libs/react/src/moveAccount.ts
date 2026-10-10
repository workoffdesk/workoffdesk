import type { Api } from '@workoffdesk/client/base/api';
import { createAccountMove } from '@workoffdesk/client/sessions/moveAccount';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useStore } from './store';

// A session page's way on once its account hit a limit (sessions/moveAccount.ts). runsOn: the account the session
// runs on, by its email, as last heard; send: says a message to the session.
export function useAccountMove(api: Api, runsOn: string | undefined, send: (text: string) => void) {
  const latest = useRef(send);
  useLayoutEffect(() => {
    latest.current = send;
  });
  const move = useMemo(() => createAccountMove(api, (text) => latest.current(text)), [api]);
  useEffect(() => {
    void move.load(runsOn);
    move.seen(runsOn);
  }, [move, runsOn]);
  return { move, ...useStore(move) };
}
