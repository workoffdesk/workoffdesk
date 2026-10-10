import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnScreen } from '../../src/model/chat';
import {
  askDue,
  askScreen,
  behindMac,
  caughtUp,
  forgetJournal,
  haveJournal,
  journalHeads,
  live,
  onAskScreen,
  onHaveJournal,
  onHeads,
  onPush,
  onWatchScreenText,
  pollDelay,
  pushed,
  screenNow,
  screenRead,
  screenTextWatched,
  watchScreenText,
  type JournalAt,
  type Push,
} from '../../src/journal/pushes';

// The module keeps one state for the page; each test has sessions of its own.
let n = 0;
const session = () => `s${++n}`;
const screen: OnScreen = { choices: null, panel: null };

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => {
  vi.useRealTimers();
  journalHeads(null);
});

describe('live, askDue and pollDelay', () => {
  it('is live for 10 seconds after the Mac last pushed, and not before it has', () => {
    const id = session();
    expect(live(id)).toBe(false);
    pushed(id, { type: 'alive' });
    vi.advanceTimersByTime(9999);
    expect(live(id)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(live(id)).toBe(false);
  });

  it('is not made live by an answer the page asked for', () => {
    const id = session();
    screenRead(id, screen);
    expect(live(id)).toBe(false);
  });

  it('looks again as asked while quiet, else once the line would go quiet, at most every 30 seconds', () => {
    const id = session();
    expect(pollDelay(id, 3000)).toBe(3000);
    pushed(id, { type: 'alive' });
    expect(pollDelay(id, 3000)).toBe(13_000);
    expect(pollDelay(id, 25_000)).toBe(30_000);
    vi.advanceTimersByTime(9999);
    expect(pollDelay(id, 3000)).toBe(3001);
    vi.advanceTimersByTime(1);
    expect(pollDelay(id, 3000)).toBe(3000);
    expect(pollDelay(id, 40_000)).toBe(40_000);
  });

  it('keeps asking due always while quiet, and only every 30 seconds while live', () => {
    const id = session();
    const asked = Date.now();
    expect(askDue(id, asked)).toBe(true);
    vi.advanceTimersByTime(29_999);
    pushed(id, { type: 'alive' });
    expect(askDue(id, asked)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(askDue(id, asked)).toBe(true);
  });
});

describe('onPush', () => {
  it('hands each push to each listening page until it stops', () => {
    const id = session();
    const a: Push[] = [];
    const b: Push[] = [];
    const stopA = onPush(id, (p) => a.push(p));
    onPush(id, (p) => b.push(p));
    onPush(session(), () => {
      throw new Error('another session heard it');
    });
    pushed(id, { type: 'screenText', text: 'one' });
    stopA();
    pushed(id, { type: 'screenText', text: 'two' });
    expect(a).toEqual([{ type: 'screenText', text: 'one' }]);
    expect(b).toEqual([
      { type: 'screenText', text: 'one' },
      { type: 'screenText', text: 'two' },
    ]);
  });

  it('keeps what the screen holds as last pushed or read, but gives it only while the line is live', () => {
    const id = session();
    const heard: Push[] = [];
    onPush(id, (p) => heard.push(p));
    screenRead(id, screen);
    expect(heard).toEqual([{ type: 'screen', screen }]);
    expect(screenNow(id)).toBeUndefined();
    const newer: OnScreen = { choices: null, panel: null, suggestion: 'run the tests' };
    pushed(id, { type: 'screen', screen: newer });
    expect(screenNow(id)).toBe(newer);
    pushed(id, { type: 'alive' });
    expect(screenNow(id)).toBe(newer);
    vi.advanceTimersByTime(10_000);
    expect(screenNow(id)).toBeUndefined();
  });
});

describe('askScreen and onAskScreen', () => {
  it('is taken when any line takes it, and not when none is open', () => {
    const id = session();
    expect(askScreen(id)).toBe(false);
    const asked: string[] = [];
    const stopA = onAskScreen(id, () => (asked.push('a'), false));
    expect(askScreen(id)).toBe(false);
    onAskScreen(id, () => (asked.push('b'), true));
    expect(askScreen(id)).toBe(true);
    stopA();
    expect(askScreen(id)).toBe(true);
    expect(asked).toEqual(['a', 'a', 'b', 'b']);
  });

  it('goes to every line, even once one has taken it', () => {
    const id = session();
    const asked: string[] = [];
    onAskScreen(id, () => (asked.push('a'), true));
    onAskScreen(id, () => (asked.push('b'), true));
    expect(askScreen(id)).toBe(true);
    expect(asked).toEqual(['a', 'b']);
  });
});

describe('watchScreenText', () => {
  it('asks the line once for the first watcher and stops once for the last', () => {
    const id = session();
    const said: boolean[] = [];
    onWatchScreenText(id, (on) => (said.push(on), true));
    expect(screenTextWatched(id)).toBe(false);
    const first = watchScreenText(id);
    const second = watchScreenText(id);
    expect(said).toEqual([true]);
    first();
    first();
    expect(screenTextWatched(id)).toBe(true);
    expect(said).toEqual([true]);
    second();
    expect(screenTextWatched(id)).toBe(false);
    expect(said).toEqual([true, false]);
    watchScreenText(id);
    expect(said).toEqual([true, false, true]);
  });
});

describe('haveJournal and onHaveJournal', () => {
  it('tells the line now if known and each time it is said again, until it stops listening', () => {
    const id = session();
    const heard: JournalAt[] = [];
    haveJournal(id, { epoch: 'e1', v: 3 });
    const stop = onHaveJournal(id, (at) => heard.push(at));
    haveJournal(id, { epoch: 'e1', v: 5 });
    stop();
    haveJournal(id, { epoch: 'e1', v: 6 });
    expect(heard).toEqual([
      { epoch: 'e1', v: 3 },
      { epoch: 'e1', v: 5 },
    ]);
  });

  it('tells nothing once forgotten', () => {
    const id = session();
    haveJournal(id, { epoch: 'e1', v: 3 });
    forgetJournal(id);
    const heard: JournalAt[] = [];
    onHaveJournal(id, (at) => heard.push(at));
    expect(heard).toEqual([]);
  });
});

describe('journalHeads and onHeads', () => {
  it.each<[string, { epoch: string | null; v: number }, boolean, boolean]>([
    ['at the head', { epoch: 'e1', v: 5 }, true, false],
    ['behind it', { epoch: 'e1', v: 4 }, false, true],
    ['ahead of it, the socket not caught up yet', { epoch: 'e1', v: 6 }, false, false],
    ['of a journal started over', { epoch: 'e0', v: 5 }, false, true],
    ['of no journal yet', { epoch: null, v: 0 }, false, true],
  ])('say a copy %s is caught up: %s, behind: %s', (_, at, caught, behind) => {
    journalHeads({ epoch: 'e1', heads: { s: 5 } });
    expect(caughtUp('s', at)).toBe(caught);
    expect(behindMac('s', at)).toBe(behind);
  });

  it('say nothing of a session they do not name, or while the socket is not open', () => {
    journalHeads({ epoch: 'e1', heads: { s: 5 } });
    expect([caughtUp('other', { epoch: 'e1', v: 5 }), behindMac('other', { epoch: 'e1', v: 0 })]).toEqual([false, false]);
    journalHeads(null);
    expect([caughtUp('s', { epoch: 'e1', v: 5 }), behindMac('s', { epoch: 'e1', v: 0 })]).toEqual([false, false]);
  });

  it('are heard each time they are said, and when they no longer can be, until listening stops', () => {
    let heard = 0;
    const stop = onHeads(() => heard++);
    journalHeads({ epoch: 'e1', heads: {} });
    journalHeads(null);
    stop();
    journalHeads({ epoch: 'e1', heads: {} });
    expect(heard).toBe(2);
  });
});
