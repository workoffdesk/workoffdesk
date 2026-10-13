import { describe, expect, it } from 'vitest';
import { folderBeside, listView, matches } from '../../src/sessions/sessionListView';
import type { TermSession } from '../../src/base/api';
import { aSession } from '../helpers/fakes';

const app = aSession({ id: 'a', title: 'Fix the build', cwd: '/Users/me/code/app', lastActivity: 30 });
const api = aSession({ id: 'b', title: 'Rate limits', cwd: '/srv/api', lastActivity: 50 });
const app2 = aSession({ id: 'c', title: 'Dark mode', cwd: '/Users/me/code/app', lastActivity: 10 });
const root = aSession({ id: 'd', title: '/', cwd: '/', lastActivity: 20 });
// Nothing runs in these: one gone from tmux, one whose Claude quit in its terminal.
const past = aSession({ id: 'e', title: 'Old fix', cwd: '/srv/api', lastActivity: 60, status: 'ended', past: true });
const quit = aSession({ id: 'f', title: 'Quit one', cwd: '/Users/me/code/app', lastActivity: 40, status: 'ended' });
const shell = aSession({ id: 'g', title: 'zsh', kind: 'shell', cwd: '/srv/api', lastActivity: 5, status: null });

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
    expect(listView(null, '', 'project')).toEqual({ sorted: null, shown: [], groups: [] });
  });

  it('puts the newest first and leaves the given list as it was', () => {
    const given = [app, api, app2];
    expect(listView(given, '', 'project').sorted?.map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(given.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('groups by folder, the folder worked in last first, each named by its last part', () => {
    expect(listView([app, api, app2], '', 'project').groups).toEqual([
      { cwd: '/srv/api', title: 'api', sessions: [api] },
      { cwd: '/Users/me/code/app', title: 'app', sessions: [app, app2] },
    ]);
  });

  it('names the root folder by its path', () => {
    expect(listView([root, api], '', 'project').groups.map((g) => g.title)).toEqual(['api', '/']);
  });

  it('gives a single folder no heading', () => {
    expect(listView([app, app2], '', 'project').groups).toEqual([{ cwd: '/Users/me/code/app', title: null, sessions: [app, app2] }]);
  });

  it('shows and groups only what matches the search, keeping the whole list sorted', () => {
    const v = listView([app, api, app2], 'mode', 'project');
    expect(v.sorted).toHaveLength(3);
    expect(v.shown).toEqual([app2]);
    expect(v.groups).toEqual([{ cwd: '/Users/me/code/app', title: null, sessions: [app2] }]);
  });

  it('puts the sessions nothing runs in last, in one group of their own, the newest first', () => {
    expect(listView([app, past, api, quit, app2, shell], '', 'project').groups).toEqual([
      { cwd: '/srv/api', title: 'api', sessions: [api, shell] },
      { cwd: '/Users/me/code/app', title: 'app', sessions: [app, app2] },
      { cwd: null, title: 'Ended', sessions: [past, quit] },
    ]);
  });

  it('names the ended group even when it is the only one, and names no single running folder', () => {
    expect(listView([past, quit], '', 'project').groups.map((g) => g.title)).toEqual(['Ended']);
    expect(listView([app, quit], '', 'project').groups.map((g) => g.title)).toEqual([null, 'Ended']);
  });

  it('searches the ended ones too', () => {
    expect(listView([app, past, quit], 'old', 'project').groups).toEqual([{ cwd: null, title: 'Ended', sessions: [past] }]);
  });
});

describe('listView, by project', () => {
  // Three worktrees of one repository and a folder inside its checkout, and a folder outside git.
  const shop = '/Users/me/code/shop';
  const main = aSession({ id: 'm', title: 'Main', cwd: shop, project: shop, lastActivity: 70 });
  const wt1 = aSession({ id: 'w1', title: 'Checkout', cwd: '/Users/me/worktrees/shop/checkout', project: shop, lastActivity: 90 });
  const wt2 = aSession({ id: 'w2', title: 'Cart', cwd: '/Users/me/code/shop/.claude/worktrees/cart', project: shop, lastActivity: 20 });
  const docs = aSession({ id: 'dd', title: 'Docs', cwd: '/Users/me/code/shop/docs', project: shop, lastActivity: 15 });
  const notes = aSession({ id: 'n', title: 'Notes', cwd: '/Users/me/notes', lastActivity: 80 });
  const gone = aSession({ id: 'x', title: 'Old', cwd: '/Users/me/worktrees/shop/old', project: shop, lastActivity: 99, status: 'ended', past: true });

  it("puts a repository's worktrees and folders in one group, named after it, the one worked in last first", () => {
    expect(listView([main, wt1, wt2, docs, notes, gone], '', 'project').groups).toEqual([
      { cwd: shop, title: 'shop', sessions: [wt1, main, wt2, docs] },
      { cwd: '/Users/me/notes', title: 'notes', sessions: [notes] },
      { cwd: null, title: 'Ended', sessions: [gone] },
    ]);
  });

  it('gives a single project no heading', () => {
    expect(listView([main, wt1], '', 'project').groups.map((g) => g.title)).toEqual([null]);
  });

  it('lists everything running as one, the newest first, when not grouped, the ended ones still last', () => {
    expect(listView([main, wt1, notes, gone, app], '', 'none').groups).toEqual([
      { cwd: null, title: null, sessions: [wt1, notes, main, app] },
      { cwd: null, title: 'Ended', sessions: [gone] },
    ]);
  });

  it('has no groups when nothing fits the search, either way', () => {
    expect(listView([main, notes], 'nothing like it', 'none').groups).toEqual([]);
    expect(listView([main, notes], 'nothing like it', 'project').groups).toEqual([]);
  });

  it.each<[string, TermSession, string | null]>([
    ["a worktree's own name", wt1, 'checkout'],
    ["a folder's inside the checkout", docs, 'docs'],
    ['nothing in the main checkout: the heading says it', main, null],
  ])('says under the project heading %s', (_, s, folder) => {
    const group = listView([s, notes], '', 'project').groups.find((g) => g.sessions.includes(s))!;
    expect(group.title).toBe('shop');
    expect(folderBeside(s, group)).toBe(folder);
  });

  it('says nothing beside a title that already is that name', () => {
    const byFolder = aSession({ id: 'k', title: 'checkout', cwd: wt1.cwd, project: shop });
    const byProject = aSession({ id: 'p', title: 'shop', cwd: wt1.cwd, project: shop });
    expect(folderBeside(byFolder, { cwd: shop, title: 'shop', sessions: [byFolder] })).toBeNull();
    expect(folderBeside(byProject, { cwd: null, title: null, sessions: [byProject] })).toBeNull();
  });

  it('says the project of a row with no heading over it, or under Ended', () => {
    const [flat, ended] = listView([wt1, gone], '', 'none').groups;
    expect(folderBeside(wt1, flat)).toBe('shop');
    expect(folderBeside(gone, ended)).toBe('shop');
  });
});

describe('listView, with pinned sessions', () => {
  const shop = '/Users/me/code/shop';
  const main = aSession({ id: 'm', title: 'Main', cwd: shop, project: shop, lastActivity: 70 });
  const cart = aSession({ id: 'c', title: 'Cart', cwd: '/Users/me/worktrees/shop/cart', project: shop, lastActivity: 90 });
  const notes = aSession({ id: 'n', title: 'Notes', cwd: '/Users/me/notes', lastActivity: 80 });
  // Pinned one after the other, the first long since worked in, the second ended.
  const first = aSession({ id: 'p1', title: 'First pin', cwd: '/Users/me/notes', lastActivity: 99, pinned: 1000 });
  const second = aSession({ id: 'p2', title: 'Second pin', cwd: shop, project: shop, lastActivity: 5, pinned: 2000, status: 'ended', past: true });
  const old = aSession({ id: 'o', title: 'Old', cwd: shop, project: shop, lastActivity: 60, status: 'ended', past: true });

  it.each(['project', 'none'] as const)('puts them first, the one pinned last on top, whenever each was worked in, and nowhere else (%s)', (grouping) => {
    const { groups } = listView([main, cart, notes, first, second, old], '', grouping);
    expect(groups[0]).toEqual({ cwd: null, title: null, sessions: [second, first] });
    expect(groups.slice(1).flatMap((g) => g.sessions)).toEqual(grouping === 'project' ? [cart, main, notes, old] : [cart, notes, main, old]);
    expect(groups.at(-1)).toEqual({ cwd: null, title: 'Ended', sessions: [old] });
  });

  // Their rows are told apart by their colour, as a chat app's are, so what follows is headed as with none pinned.
  it.each(['project', 'none'] as const)('heads them and what follows as it would be headed with none pinned (%s)', (grouping) => {
    for (const list of [[main, cart], [main, cart, notes], [main, old]]) {
      const titles = (sessions: typeof list) => listView(sessions, '', grouping).groups.map((g) => g.title);
      expect(titles([...list, first]), `with ${list.map((s) => s.title).join(', ')}`).toEqual([null, ...titles(list)]);
    }
  });

  it('groups as before when none is pinned, or none that fits the search', () => {
    expect(listView([main, cart], '', 'project').groups.map((g) => g.title)).toEqual([null]);
    expect(listView([main, cart, first], 'cart', 'none').groups).toEqual([{ cwd: null, title: null, sessions: [cart] }]);
  });

  it('narrows them by the search as the rest', () => {
    expect(listView([main, first, second], 'second', 'project').groups).toEqual([{ cwd: null, title: null, sessions: [second] }]);
  });

  it('says the project beside a pinned row', () => {
    const [pinned] = listView([second, cart], '', 'project').groups;
    expect(folderBeside(second, pinned)).toBe('shop');
  });
});

describe('folderBeside', () => {
  const named = aSession({ title: 'Fix the build', cwd: '/srv/api' });
  it.each<[string, { cwd: string | null; title: string | null }, string | null]>([
    ['under its folder', { cwd: '/srv/api', title: 'api' }, null],
    ['with no heading', { cwd: '/srv/api', title: null }, 'api'],
    ['under the ended heading, which names no folder', { cwd: null, title: 'Ended' }, 'api'],
  ])('says a named row\'s folder only where no heading says it: %s', (_, group, folder) => {
    expect(folderBeside(named, { ...group, sessions: [named] })).toBe(folder);
  });
});
