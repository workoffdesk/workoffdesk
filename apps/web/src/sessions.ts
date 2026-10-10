import { useSyncExternalStore } from 'react';
import type { TermSession } from './api';
import { MAC_KEY } from '@workoffdesk/client/sessions/macRecent';
import { sessionList, storage } from './platform';

// What a logged-out browser must not show the next person.
export function forgetSessions() {
  sessionList.forget();
  try {
    storage.removeItem(MAC_KEY);
  } catch {
    // nothing was kept
  }
}

// One live view of the session list for the whole page, fed by /api/events (sessionList.ts).
export function useSessions(): TermSession[] | null {
  return useSyncExternalStore(sessionList.subscribe, sessionList.current);
}
