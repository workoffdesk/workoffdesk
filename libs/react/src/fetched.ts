import { errorText } from '@workoffdesk/client/base/api';
import { t } from '@workoffdesk/i18n';
import { useEffect, useState } from 'react';

// What `load` gives, asked once for each `load`; what went wrong in words if it fails.
export function useFetched<T>(load: () => Promise<T>): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let gone = false;
    load().then(
      (data) => !gone && setState({ data, error: null }),
      (e) => !gone && setState({ data: null, error: errorText(e, t.loadFailed) }),
    );
    return () => {
      gone = true;
    };
  }, [load]);
  return state;
}
