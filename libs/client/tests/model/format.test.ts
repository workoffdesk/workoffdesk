import { afterAll, describe, expect, it, vi } from 'vitest';
import { clock, dirName, duration, listTime, ownName, sessionPreview, shortPath, statusLabel, timeAgo } from '../../src/model/format';

// The format module as a phone that puts these languages first loads it.
async function formatFor(languages: string[]) {
  vi.resetModules();
  vi.stubGlobal('navigator', { language: languages[0], languages });
  return import('../../src/model/format');
}
afterAll(() => {
  vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });
});

describe('listTime', () => {
  // Saturday 3 October 2026, 16:02 local time.
  const now = new Date(2026, 9, 3, 16, 2).getTime();
  const at = (...d: [number, number, number, number?, number?]) => new Date(...(d as [number, number, number, number, number])).getTime();

  it.each([
    ['today, by the clock', at(2026, 9, 3, 15, 57), '15:57'],
    ['just after midnight today', at(2026, 9, 3, 0, 5), '00:05'],
    ['yesterday, by name', at(2026, 9, 2, 23, 59), 'Yesterday'],
    ['earlier this week, by weekday', at(2026, 8, 28, 9, 0), 'Monday'],
    ['six days ago, still by weekday', at(2026, 8, 27, 9, 0), 'Sunday'],
    ['a week ago, by date', at(2026, 8, 26, 9, 0), 'Sep 26'],
    ['earlier this year', at(2026, 0, 2, 9, 0), 'Jan 2'],
    ['another year', at(2025, 11, 31, 9, 0), '12/31/2025'],
    ['a clock a little ahead of this one', at(2026, 9, 3, 16, 3), '16:03'],
  ])('shows a time %s', (_, ms, expected) => {
    expect(listTime(ms, now)).toBe(expected);
  });

  it.each([
    [['zh-CN'], ['15:57', '昨天', '星期一', '9月26日', '2025/12/31']],
    [['zh-Hant-TW', 'en-US'], ['15:57', '昨天', '星期一', '9月26日', '2025/12/31']],
    [['fr-FR', 'zh-CN'], ['15:57', '昨天', '星期一', '9月26日', '2025/12/31']],
    [['fr-FR', 'en-GB'], ['15:57', 'Yesterday', 'Monday', 'Sep 26', '12/31/2025']],
    [['ja-JP'], ['15:57', 'Yesterday', 'Monday', 'Sep 26', '12/31/2025']],
  ])('speaks the language of a phone that puts %j first', async (languages, expected) => {
    const { listTime: inIt } = await formatFor(languages);
    const days = [at(2026, 9, 3, 15, 57), at(2026, 9, 2, 23, 59), at(2026, 8, 28, 9, 0), at(2026, 8, 26, 9, 0), at(2025, 11, 31, 9, 0)];
    expect(days.map((d) => inIt(d, now))).toEqual(expected);
  });
});

describe('sessionPreview', () => {
  const claude = (status: 'working' | 'waiting' | 'idle' | 'ended' | 'compacting', lastReply: string | null = '改好了。') =>
    ({ kind: 'claude' as const, status, cwd: '/Users/me/p', lastReply });

  it.each([
    ['what Claude said last, while it waits for nothing', claude('idle'), '改好了。'],
    ['that Claude is at work, over what it said before', claude('working'), 'Working…'],
    ['that Claude is compacting its conversation, which holds what is sent', claude('compacting'), 'Compacting context…'],
    ['that Claude waits on an answer', claude('waiting'), 'Needs you'],
    ['that the session has ended', claude('ended'), 'Ended'],
    ['the folder, before Claude has said anything', claude('idle', null), '~/p'],
    ['the folder, for a shell', { kind: 'shell' as const, status: null, cwd: '/Users/me/p', lastReply: null }, '~/p'],
  ])('shows %s', (_, s, expected) => {
    expect(sessionPreview(s)).toBe(expected);
  });
});

describe('deviceLabel', () => {
  it.each([
    ['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605 Version/18.0 Mobile/15E148 Safari/604.1', 'iPad · Safari'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36', 'Android · Chrome'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0', 'Windows · Edge'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Windows · Firefox'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605 CriOS/131.0 Mobile/15E148 Safari/604.1', 'iPhone · Chrome'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605 FxiOS/133.0 Mobile/15E148 Safari/605.1', 'iPhone · Firefox'],
    ['WorkOffDesk/2.18.0 (iPad; iPadOS 26.0)', 'iPad · WorkOffDesk'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605', 'Mac'],
  ])('names %s as %s', async (ua, expected) => {
    const { deviceLabel } = await import('../../src/model/format');
    expect(deviceLabel(ua)).toBe(expected);
  });

  it('names browsers as before and the iPhone app by its own name', async () => {
    const { deviceLabel } = await import('../../src/model/format');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36')).toBe('Mac · Chrome');
    expect(deviceLabel('WorkOffDesk/1.0.0 (iPhone; iOS 26.0)')).toBe('iPhone · WorkOffDesk');
    expect(deviceLabel('curl/8')).toBe('Device');
  });
});

describe('statusLabel', () => {
  // An ended session says so whatever it ran: a shell's header must not go on naming it "Shell" once it is gone.
  it.each([
    [{ kind: 'shell' as const, status: 'ended' as const }, 'Ended'],
    [{ kind: 'claude' as const, status: 'ended' as const }, 'Ended'],
    [{ kind: 'shell' as const, status: null }, 'Shell'],
    [{ kind: 'claude' as const, status: null }, 'Claude'],
    [{ kind: 'claude' as const, status: 'working' as const }, 'Working'],
  ])('labels %o as %s', (s, expected) => {
    expect(statusLabel(s)).toBe(expected);
  });
});

describe('timeAgo', () => {
  const now = new Date(2026, 9, 3, 16, 2).getTime();
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  it.each([
    ['a clock a little ahead of this one', -5 * SEC, 'just now'],
    ['under a minute', 59.4 * SEC, 'just now'],
    ['a minute, to the nearest', 59.5 * SEC, '1 min ago'],
    ['under an hour, to the nearest minute', 59 * MIN + 29 * SEC, '59 min ago'],
    ['an hour, to the nearest', 59 * MIN + 30 * SEC, '1 h ago'],
    ['under a day, to the nearest hour', 1409 * MIN, '23 h ago'],
    ['a day, to the nearest', 1410 * MIN, '1 d ago'],
    ['under a month, to the nearest day', 707 * HOUR, '29 d ago'],
    ['a month or more, by date', 708 * HOUR, '9/4/2026'],
  ])('shows a time %s', (_, ago, expected) => {
    expect(timeAgo(now - ago, now)).toBe(expected);
  });
});

describe('shortPath, dirName and ownName', () => {
  it.each<[string | null, string]>([
    [null, ''],
    ['', ''],
    ['/Users/someone/work/app', '~/work/app'],
    ['/Users/someone', '~'],
    ['/Users/', '/Users/'],
    ['/work/app', '/work/app'],
  ])('shortens %j to %j', (p, expected) => {
    expect(shortPath(p)).toBe(expected);
  });

  it.each([
    ['/work/app', 'app'],
    ['/work/app/', 'app'],
    ['app', 'app'],
    ['/', '/'],
  ])('names %j by its last folder, %j', (cwd, expected) => {
    expect(dirName(cwd)).toBe(expected);
  });

  it('gives no name of its own to a session named after its folder', () => {
    expect(ownName({ title: 'app', cwd: '/work/app' })).toBe('');
    expect(ownName({ title: 'fix the login', cwd: '/work/app' })).toBe('fix the login');
  });
});

describe('duration', () => {
  it.each([
    [-5, '0s'],
    [999, '0s'],
    [59_999, '59s'],
    [60_000, '1m 0s'],
    [125_500, '2m 5s'],
  ])('formats %d ms as %s', (ms, expected) => {
    expect(duration(ms)).toBe(expected);
  });
});

describe('clock', () => {
  it('shows the time of day, two digits each', () => {
    expect(clock(new Date(2026, 9, 3, 9, 5).toISOString())).toBe('09:05');
    expect(clock(new Date(2026, 9, 3, 23, 41).toISOString())).toBe('23:41');
  });

  it.each([undefined, '', 'yesterday'])('returns nothing for %j', (iso) => {
    expect(clock(iso)).toBe('');
  });
});
