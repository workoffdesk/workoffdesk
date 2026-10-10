import { describe, expect, it } from 'vitest';
import { listView, matches } from '../../src/sessions/sessionListView';
import { aSession } from '../helpers/fakes';

const app = aSession({ id: 'a', title: 'Fix the build', cwd: '/Users/me/code/app', lastActivity: 30 });
const api = aSession({ id: 'b', title: 'Rate limits', cwd: '/srv/api', lastActivity: 50 });
const app2 = aSession({ id: 'c', title: 'Dark mode', cwd: '/Users/me/code/app', lastActivity: 10 });
const root = aSession({ id: 'd', title: '/', cwd: '/', lastActivity: 20 });

describe('matches', () => {
  it.each([
    ['an empty search', '', true],
    ['blanks only', '   ', true],
    ['part of the title, in any case', 'BUILD', true],
    ['part of the folder', '/users/me/code', true],
    ['the folder as shown, from home', '~/code/app', true],
    ['words that are nowhere', 'deploy', false],
  ])('tells whether a session fits %s', (_, query, fits) => {
    expect(matches(app, query)).toBe(fits);
  });
});

describe('listView', () => {
  it('is loading while there is no list', () => {
    expect(listView(null, '')).toEqual({ sorted: null, shown: [], groups: [] });
  });

  it('puts the newest first and leaves the given list as it was', () => {
    const given = [app, api, app2];
    expect(listView(given, '').sorted?.map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(given.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('groups by folder, the folder worked in last first, each named by its last part', () => {
    expect(listView([app, api, app2], '').groups).toEqual([
      { cwd: '/srv/api', title: 'api', sessions: [api] },
      { cwd: '/Users/me/code/app', title: 'app', sessions: [app, app2] },
    ]);
  });

  it('names the root folder by its path', () => {
    expect(listView([root, api], '').groups.map((g) => g.title)).toEqual(['api', '/']);
  });

  it('gives a single folder no heading', () => {
    expect(listView([app, app2], '').groups).toEqual([{ cwd: '/Users/me/code/app', title: null, sessions: [app, app2] }]);
  });

  it('shows and groups only what matches the search, keeping the whole list sorted', () => {
    const v = listView([app, api, app2], 'mode');
    expect(v.sorted).toHaveLength(3);
    expect(v.shown).toEqual([app2]);
    expect(v.groups).toEqual([{ cwd: '/Users/me/code/app', title: null, sessions: [app2] }]);
  });
});
