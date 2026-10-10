import { t } from '@workoffdesk/i18n';
import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../../src/base/api';
import { listed, LOADING } from '../../src/base/listed';

describe('listed', () => {
  it('is loading until the list comes', () => {
    expect(LOADING).toEqual({ state: 'loading' });
  });

  it.each([[[]], [[{ id: 'a' }]]])('holds what came, an empty list as empty (%j)', async (rows) => {
    expect(await listed(Promise.resolve(rows))).toEqual({ state: 'loaded', rows });
  });

  it.each([
    ['the server cannot be reached', new NetworkError('Load failed'), t.noServer],
    ['the server refused it', new ApiError(500, ''), t.loadFailed],
    ['anything else went wrong', new Error('UnexpectedException'), t.loadFailed],
  ])('reports a failure, never empty or loading, when %s', async (_, e, said) => {
    expect(await listed(Promise.reject(e))).toEqual({ state: 'failed', error: said });
  });
});
