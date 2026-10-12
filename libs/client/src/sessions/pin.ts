import { t } from '@workoffdesk/i18n';
import { errorText, MACHINE, type Api, type TermSession } from '../base/api';

// A row's Pin or Unpin. The list comes back from the Mac with it changed; run says why it could not, or null.
export function pinAction(api: Api, s: Pick<TermSession, 'id' | 'pinned'>): { label: string; run: () => Promise<string | null> } {
  const method = s.pinned ? 'DELETE' : 'PUT';
  return {
    label: s.pinned ? t.unpin : t.pin,
    run: () =>
      api<void>(`/api/m/${MACHINE}/sessions/${s.id}/pin`, { method, idempotent: true }).then(
        () => null,
        (e: unknown) => errorText(e, t.pinFailed),
      ),
  };
}
