import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/base/api';
import { leaveSession } from '../../src/sessions/leave';
import { aSession, fakeApi, fakeList } from '../helpers/fakes';

// From the list a running session is ended, and stays as past; a past one is deleted, and leaves it.
describe('leaveSession', () => {
  it.each([
    ['ends a running session, which the list keeps as past', aSession({ id: 's1' }), { endedHere: ['s1'], dropped: [] }],
    ['deletes a past session, which leaves the list', aSession({ id: 's1', past: true, status: 'ended' }), { endedHere: [], dropped: ['s1'] }],
  ])('%s', async (_, s, told) => {
    const { api, answer } = fakeApi();
    const list = fakeList([s]);
    const done = leaveSession(api, list, s);
    await answer('DELETE /api/m/local/sessions/s1');
    await done;
    expect({ endedHere: list.endedHere, dropped: list.dropped }).toEqual(told);
  });

  it('tells the list nothing when the Mac refuses, and says why to the caller', async () => {
    const { api, fail } = fakeApi();
    const list = fakeList([aSession({ id: 's1' })]);
    const done = leaveSession(api, list, aSession({ id: 's1' }));
    await fail('DELETE /api/m/local/sessions/s1', new ApiError(500, ''));
    await expect(done).rejects.toBeInstanceOf(ApiError);
    expect([...list.endedHere, ...list.dropped]).toEqual([]);
  });
});
