import { MACHINE, type Api } from '../base/api';
import type { SessionList } from './sessionList';

// A name given a session here shows at once, without waiting on the line to the Mac; naming twice is naming
// once, so a save that hangs is sent again. One the Mac refuses is taken back and thrown to say why.
export async function renameSession(api: Api, list: Pick<SessionList, 'naming'>, id: string, title: string): Promise<void> {
  list.naming(id, title);
  try {
    await api(`/api/m/${MACHINE}/sessions/${id}`, { method: 'PATCH', json: { title }, idempotent: true });
  } catch (e) {
    list.naming(id, null);
    throw e;
  }
}
