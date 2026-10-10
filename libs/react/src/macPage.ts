import type { Api } from '@workoffdesk/client/base/api';
import { createMacPage } from '@workoffdesk/client/mac/macPage';
import { lang } from '@workoffdesk/i18n';
import { useEffect, useMemo } from 'react';
import { useStore } from './store';

// The page about this Mac, held while it is shown, and how many of the Mac's checks fail.
export function useMacPage(api: Api) {
  const page = useMemo(() => createMacPage(api, lang), [api]);
  useEffect(() => page.hold(), [page]);
  const state = useStore(page);
  const failed = state.report?.checks.filter((c) => !c.ok).length ?? 0;
  return { page, ...state, failed };
}
