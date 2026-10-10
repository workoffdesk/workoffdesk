import { t } from '@workoffdesk/i18n';
import { errorText } from './api';

// A list a screen loads: on its way, failed (said in words, to offer a retry), or what came. A failure is
// never shown as an empty list or as still loading.
export type Listed<T> = { state: 'loading' } | { state: 'failed'; error: string } | { state: 'loaded'; rows: T[] };

export const LOADING: Listed<never> = { state: 'loading' };

export const listed = <T>(load: Promise<T[]>): Promise<Listed<T>> =>
  load.then(
    (rows) => ({ state: 'loaded', rows }),
    (e: unknown) => ({ state: 'failed', error: errorText(e, t.loadFailed) }),
  );
