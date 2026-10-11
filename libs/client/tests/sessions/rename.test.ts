import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/base/api';
import { renameSession } from '../../src/sessions/rename';
import { fakeApi, fakeList } from '../helpers/fakes';

// A name given here shows at once and goes to the Mac behind it; one the Mac refuses is taken back.
describe('renameSession', () => {
  it('shows the name before the Mac answers, and sends it as a save that may be sent again', async () => {
    const { api, answer, waiting, init } = fakeApi();
    const list = fakeList([]);
    const done = renameSession(api, list, 's1', 'Fix the login');
    expect(list.named).toEqual([['s1', 'Fix the login']]);
    expect(waiting()).toEqual(['PATCH /api/m/local/sessions/s1']);
    expect(init('PATCH /api/m/local/sessions/s1')).toMatchObject({ json: { title: 'Fix the login' }, idempotent: true });
    await answer('PATCH /api/m/local/sessions/s1');
    await done;
    expect(list.named).toEqual([['s1', 'Fix the login']]);
  });

  it('takes the name back when the Mac refuses it, and says why to the caller', async () => {
    const { api, fail } = fakeApi();
    const list = fakeList([]);
    const done = renameSession(api, list, 's1', 'Fix the login');
    await fail('PATCH /api/m/local/sessions/s1', new ApiError(500, ''));
    await expect(done).rejects.toBeInstanceOf(ApiError);
    expect(list.named).toEqual([['s1', 'Fix the login'], ['s1', null]]);
  });
});
