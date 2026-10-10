import { t } from '@workoffdesk/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkError } from '../../src/base/api';
import { createProjectSearch, DIRS_WAIT_MS, into, isPath, matchProjects } from '../../src/sessions/projectSearch';
import { fakeApi } from '../helpers/fakes';

const asked = (path: string) => `GET /api/m/local/dirs?path=${encodeURIComponent(path)}`;

describe('isPath', () => {
  it.each(['~', '~/', '~/code', '/', '/Users/me'])('is true for %s', (q) => {
    expect(isPath(q)).toBe(true);
  });

  it.each(['', 'code', 'we', '~bob', 'code/web'])('is false for the search "%s"', (q) => {
    expect(isPath(q)).toBe(false);
  });
});

describe('matchProjects', () => {
  const known = ['/Users/me/code/news-feed', '/Users/me/code/new-web-site', '/Users/me/code/weather-app', '/Users/me/web', '/Users/me/work/wxb'];

  it('returns all of them, as they came, for an empty search', () => {
    expect(matchProjects(known, '')).toEqual(known);
  });

  it('ranks names starting with the query, then names containing it, then paths holding its letters in order, each as they came', () => {
    expect(matchProjects(known, 'we')).toEqual(['/Users/me/code/weather-app', '/Users/me/web', '/Users/me/code/new-web-site', '/Users/me/code/news-feed']);
  });

  it('ignores case', () => {
    expect(matchProjects(known, 'WEA')).toEqual(['/Users/me/code/weather-app']);
  });

  it('returns none when nothing holds the letters in order', () => {
    expect(matchProjects(known, 'zq')).toEqual([]);
  });
});

describe('into', () => {
  it.each([
    ['~/code/we', '/Users/me/code/weather-app', '~/code/weather-app/'],
    ['~/', '/Users/me/code', '~/code/'],
    ['~', '/Users/me/code', '~/code/'],
    ['/Users/me/co', '/Users/me/code', '/Users/me/code/'],
  ])('goes from %s into %s as %s', (typed, dir, box) => {
    expect(into(typed, dir)).toBe(box);
  });
});

describe('createProjectSearch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const api = fakeApi();
    const search = createProjectSearch(api.api);
    const release = search.hold();
    return { api, search, release, snap: () => search.getSnapshot() };
  };

  it('shows the known projects matching a search without asking the Mac', () => {
    const { api, search, snap } = setup();
    search.setKnown(['/Users/me/web', '/Users/me/api']);
    search.type('ap');
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    expect(snap().rows).toEqual(['/Users/me/api']);
    expect(api.waiting()).toEqual([]);
  });

  it('is loading until the known projects come', () => {
    const { search, snap } = setup();
    search.type('ap');
    expect(snap().rows).toBeNull();
  });

  it(`asks the Mac for a path once typing stops for ${DIRS_WAIT_MS} ms, for what is typed by then`, async () => {
    const { api, search, snap } = setup();
    search.type('~/c');
    vi.advanceTimersByTime(DIRS_WAIT_MS - 1);
    search.type('~/co');
    vi.advanceTimersByTime(DIRS_WAIT_MS - 1);
    expect(api.waiting()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(api.waiting()).toEqual([asked('~/co')]);
    expect(snap().rows).toBeNull();
    await api.answer(asked('~/co'), ['/Users/me/code']);
    expect(snap()).toMatchObject({ path: true, rows: ['/Users/me/code'], error: null });
  });

  it('keeps the folders shown while the answer for newer typing is on its way', async () => {
    const { api, search, snap } = setup();
    search.type('~/');
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    await api.answer(asked('~/'), ['/Users/me/code', '/Users/me/web']);
    search.type('~/c');
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    expect(snap().rows).toEqual(['/Users/me/code', '/Users/me/web']);
  });

  it('never shows an answer for what was typed before, whichever comes first', async () => {
    const { api, search, snap } = setup();
    search.type('~/c');
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    search.type('~/w');
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    await api.answer(asked('~/c'), ['/Users/me/code']);
    expect(snap().rows).toBeNull();
    await api.answer(asked('~/w'), ['/Users/me/web']);
    expect(snap().rows).toEqual(['/Users/me/web']);
  });

  it('never reports that an earlier path could not be read', async () => {
    const { api, search, snap } = setup();
    search.type('~/c');
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    search.type('~/w');
    await api.fail(asked('~/c'), new NetworkError());
    expect(snap()).toMatchObject({ rows: null, error: null });
  });

  it('ignores an answer that comes once the box is a search again, and shows the matches', async () => {
    const { api, search, snap } = setup();
    search.setKnown(['/Users/me/web']);
    search.type('~/c');
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    search.type('');
    await api.answer(asked('~/c'), ['/Users/me/code']);
    expect(snap()).toMatchObject({ path: false, rows: ['/Users/me/web'] });
  });

  it('shows nothing of an earlier path once the box was a search in between', async () => {
    const { api, search, snap } = setup();
    search.type('~/c');
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    await api.answer(asked('~/c'), ['/Users/me/code']);
    search.type('c');
    search.type('~/w');
    expect(snap().rows).toBeNull();
  });

  it('asks nothing for a path changed to a search before the wait is over', () => {
    const { api, search } = setup();
    search.type('~/c');
    search.type('c');
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    expect(api.waiting()).toEqual([]);
  });

  it('says why when the folders could not be read, until asked again', async () => {
    const { api, search, snap } = setup();
    search.type('~/c');
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    await api.fail(asked('~/c'), new NetworkError());
    expect(snap()).toMatchObject({ rows: [], error: t.noServer });
    search.type('~/co');
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    await api.answer(asked('~/co'), ['/Users/me/code']);
    expect(snap()).toMatchObject({ rows: ['/Users/me/code'], error: null });
  });

  it('looks up what is typed without the spaces around it', () => {
    const { api, search } = setup();
    search.type('  ~/c ');
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    expect(api.waiting()).toEqual([asked('~/c')]);
  });

  it('asks nothing more and changes nothing once released', async () => {
    const { api, search, release, snap } = setup();
    search.type('~/c');
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    search.type('~/c');
    release();
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    expect(api.waiting()).toEqual([asked('~/c')]);
    const before = snap();
    await api.answer(asked('~/c'), ['/Users/me/code']);
    search.type('~/w');
    vi.advanceTimersByTime(DIRS_WAIT_MS);
    expect(api.waiting()).toEqual([]);
    expect(snap()).toBe(before);
  });

  it('tells listeners of each change', () => {
    const { search } = setup();
    const heard = vi.fn();
    search.subscribe(heard);
    search.setKnown(['/Users/me/web']);
    search.type('w');
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
