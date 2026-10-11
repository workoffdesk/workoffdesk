import { MACHINE, type Api, type TermSession } from '../base/api';
import type { SessionList } from './sessionList';

// The one way a row is taken off from the list: a running session is ended and stays as past; a past one is
// deleted. The list shows it at once, without waiting for the Mac; a refusal is thrown to say why.
export async function leaveSession(api: Api, list: Pick<SessionList, 'drop' | 'ends'>, s: Pick<TermSession, 'id' | 'past'>): Promise<void> {
  await api(`/api/m/${MACHINE}/sessions/${s.id}`, { method: 'DELETE' });
  if (s.past) list.drop(s.id);
  else list.ends(s.id);
}
