import type { OnScreen } from '../model/chat';
import type { JournalRow } from './journalRows';

// Where a device's copy of a session's journal is: the rows up to version v of the journal `epoch`.
export type JournalAt = { epoch: string; v: number };

// What the Mac tells a session's page without being asked, on the session's own socket (sessionLink.ts):
// the screen holds something new for the chat, or the journal has new rows. `alive` says only that the line
// still carries. While the screen is watched as text (watchScreenText), it sends that text each time it
// changes.
export type Push =
  | { type: 'screen'; screen: OnScreen }
  | { type: 'screenText'; text: string }
  // Rows of the session's journal from version `from` to `v`; a catch-up also says the epoch, and reset when
  // the copy starts over.
  | { type: 'journal'; from: number; v: number; rows: JournalRow[]; epoch?: string; reset?: true; more?: boolean; older?: number | null }
  | { type: 'alive' };

// The Mac says something at least every few seconds while the page is looked at; quiet longer than this,
// the line is taken as dead and the page asks for itself as often as it used to.
const LIVE_MS = 10_000;
// How often to ask anyway while the Mac is telling: only to catch what a push might have missed. Each ask
// is a trip across a slow line, which the pushes have made already.
export const POLL_WHILE_PUSHED_MS = 30_000;

const heard = new Map<string, number>();
const listeners = new Map<string, Set<(p: Push) => void>>();
const screens = new Map<string, OnScreen>();

export function pushed(sessionId: string, p: Push): void {
  heard.set(sessionId, Date.now());
  tell(sessionId, p);
}

// What the screen holds as an answer brought it (a command's), told to the page as a push is; it says nothing
// of whether the line carries.
export const screenRead = (sessionId: string, screen: OnScreen) => tell(sessionId, { type: 'screen', screen });

function tell(sessionId: string, p: Push): void {
  if (p.type === 'screen') screens.set(sessionId, p.screen);
  for (const l of listeners.get(sessionId) ?? []) l(p);
}

// Whether the Mac is telling this session's page what changes, so asking would only cross the line again.
export const live = (sessionId: string) => Date.now() - (heard.get(sessionId) ?? 0) < LIVE_MS;

// What the screen holds for the chat as last pushed, while the line is live; undefined when it must be asked.
export const screenNow = (sessionId: string): OnScreen | undefined => (live(sessionId) ? screens.get(sessionId) : undefined);

export function onPush(sessionId: string, listener: (p: Push) => void): () => void {
  const set = listeners.get(sessionId) ?? new Set();
  set.add(listener);
  listeners.set(sessionId, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(sessionId);
  };
}

// How long to wait before looking again: `asking` when the Mac is not telling; while it is, until the line
// would be taken as dead, so a line that goes quiet is asked across within `asking` of it.
export function pollDelay(sessionId: string, asking: number): number {
  const quietIn = (heard.get(sessionId) ?? 0) + LIVE_MS - Date.now();
  return quietIn > 0 ? Math.min(POLL_WHILE_PUSHED_MS, quietIn + asking) : asking;
}

// Whether to ask the Mac now, having last asked at `asked`: always while it is not telling, otherwise only
// as seldom as POLL_WHILE_PUSHED_MS.
export const askDue = (sessionId: string, asked: number) => !live(sessionId) || Date.now() - asked >= POLL_WHILE_PUSHED_MS;

// One kind of thing a page asks the Mac for on the session's line: the listeners are the lines, each saying
// whether it took the ask.
function asks<A>() {
  const lines = new Map<string, Set<(a: A) => boolean>>();
  return {
    ask: (sessionId: string, a: A) => [...(lines.get(sessionId) ?? [])].map((l) => l(a)).some(Boolean),
    on(sessionId: string, line: (a: A) => boolean): () => void {
      const set = lines.get(sessionId) ?? new Set();
      set.add(line);
      lines.set(sessionId, set);
      return () => {
        set.delete(line);
        if (!set.size) lines.delete(sessionId);
      };
    },
  };
}

const screenAsks = asks<void>();
// Asks the Mac on the line for what the screen holds now, even if it sent it already; false when no line took
// it.
export const askScreen = (sessionId: string) => screenAsks.ask(sessionId);
export const onAskScreen = (sessionId: string, line: () => boolean) => screenAsks.on(sessionId, line);

const textWatchers = new Map<string, number>();
const textAsks = asks<boolean>();
// The screen is watched as text, for the Mac to push it each time it changes, until what this returns is
// called.
export function watchScreenText(sessionId: string): () => void {
  const n = textWatchers.get(sessionId) ?? 0;
  textWatchers.set(sessionId, n + 1);
  if (!n) textAsks.ask(sessionId, true);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const left = (textWatchers.get(sessionId) ?? 1) - 1;
    if (left) return void textWatchers.set(sessionId, left);
    textWatchers.delete(sessionId);
    textAsks.ask(sessionId, false);
  };
}
export const screenTextWatched = (sessionId: string) => (textWatchers.get(sessionId) ?? 0) > 0;
// The line hears when the watching starts and stops.
export const onWatchScreenText = (sessionId: string, line: (on: boolean) => boolean) => textAsks.on(sessionId, line);

const journals = new Map<string, JournalAt>();
const journalListeners = new Map<string, Set<(at: JournalAt) => void>>();

// Where the device's copy of the session's journal is, for the line to tell the Mac, which then sends what
// follows it.
export function haveJournal(sessionId: string, at: JournalAt): void {
  journals.set(sessionId, at);
  for (const l of journalListeners.get(sessionId) ?? []) l(at);
}

export function forgetJournal(sessionId: string): void {
  journals.delete(sessionId);
}

// The line hears where the copy is: now, if it is known, and each time it is said again.
export function onHaveJournal(sessionId: string, listener: (at: JournalAt) => void): () => void {
  const set = journalListeners.get(sessionId) ?? new Set();
  set.add(listener);
  journalListeners.set(sessionId, set);
  const now = journals.get(sessionId);
  if (now) listener(now);
  return () => {
    set.delete(listener);
    if (!set.size) journalListeners.delete(sessionId);
  };
}

// What each session's journal is at on the Mac, as the list's socket last said; nothing while that socket is
// not open, since it may have moved on meanwhile.
let heads: { epoch: string; v: Map<string, number> } | null = null;
const headsListeners = new Set<() => void>();

export function journalHeads(said: { epoch: string; heads: Record<string, number> } | null): void {
  heads = said && { epoch: said.epoch, v: new Map(Object.entries(said.heads)) };
  for (const l of headsListeners) l();
}

// Hears each time the list's socket says where the journals are, or that it no longer can.
export function onHeads(listener: () => void): () => void {
  headsListeners.add(listener);
  return () => void headsListeners.delete(listener);
}

// The copy has all the Mac has, as far as the socket says.
export const caughtUp = (sessionId: string, at: { epoch: string | null; v: number }): boolean =>
  !!heads && at.epoch === heads.epoch && heads.v.get(sessionId) === at.v;

// The Mac's journal has moved past the copy, as far as the socket says.
export function behindMac(sessionId: string, at: { epoch: string | null; v: number }): boolean {
  const v = heads?.v.get(sessionId);
  return v !== undefined && (at.epoch !== heads!.epoch || v > at.v);
}
