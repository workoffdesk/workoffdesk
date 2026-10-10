import type { createSessions, Session, SessionSnapshot } from '@workoffdesk/client/sessions/session';
import { useEffect, useSyncExternalStore } from 'react';

type Store<T> = { subscribe(listener: () => void): () => void; getSnapshot(): T };

export const useStore = <T,>(store: Store<T>): T => useSyncExternalStore(store.subscribe, store.getSnapshot);

// useSession bound to an app's sessions: the session with this id, held while the screen that shows it is mounted.
export function sessionHooks(sessions: ReturnType<typeof createSessions>) {
  return {
    useSession(id: string): [Session, SessionSnapshot] {
      const session = sessions.get(id);
      useEffect(() => session.hold(), [session]);
      return [session, useStore(session)];
    },
  };
}
