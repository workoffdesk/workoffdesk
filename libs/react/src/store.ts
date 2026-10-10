import { inFront, type Visibility } from '@workoffdesk/client/base/platform';
import type { createSessions, Session, SessionSnapshot } from '@workoffdesk/client/sessions/session';
import { useEffect, useState, useSyncExternalStore } from 'react';

type Store<T> = { subscribe(listener: () => void): () => void; getSnapshot(): T };

export const useStore = <T,>(store: Store<T>): T => useSyncExternalStore(store.subscribe, store.getSnapshot);

// A screen's own Visibility (inFront): the same object for the screen's life, told when `front` changes.
export function useInFront(app: Visibility, front: boolean): Visibility {
  const [page] = useState(() => inFront(app, front));
  useEffect(() => page.setFront(front), [page, front]);
  return page;
}

// useSession bound to an app's sessions: the session with this id, held while the screen that shows it is
// mounted. usePage: whether that screen is in front, as the app tells it.
export function sessionHooks(sessions: ReturnType<typeof createSessions>, usePage: () => Visibility) {
  return {
    useSession(id: string): [Session, SessionSnapshot] {
      const session = sessions.get(id);
      const page = usePage();
      useEffect(() => session.hold(page), [session, page]);
      return [session, useStore(session)];
    },
  };
}
