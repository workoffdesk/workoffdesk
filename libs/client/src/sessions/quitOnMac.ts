import { t } from '@workoffdesk/i18n';
import { ApiError, errorText, MACHINE, type Api } from '../base/api';

// Quits the Claudes in terminals on the Mac that hold the session's conversation too. When one there is at work or
// asking, confirm says whether to quit it anyway. Why it could not, or null.
export async function quitOnMac(api: Api, sessionId: string, confirm: () => Promise<boolean>): Promise<string | null> {
  const quit = (force: boolean) =>
    api<void>(`/api/m/${MACHINE}/sessions/${sessionId}/quit-on-mac`, { method: 'POST', json: force ? { force } : undefined, idempotent: true });
  try {
    await quit(false);
    return null;
  } catch (e) {
    if (!(e instanceof ApiError && e.code === 'open-on-mac-busy')) return errorText(e, t.failed);
  }
  if (!(await confirm())) return null;
  return quit(true).then(
    () => null,
    (e: unknown) => errorText(e, t.failed),
  );
}
