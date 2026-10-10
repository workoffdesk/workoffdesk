import { turns } from '../model/chat';
import { onThisClock } from '../base/clock';
import type { JournalItem } from '../journal/journalRows';
import type { KeyValue } from '../base/platform';

// What was picked on the cards of a session, kept on this device: the card goes once answered and the
// transcript has no record of it. Without storage nothing is kept. after: the conversation and its turn the
// chat ended with when it was picked, which it goes after; at, this device's clock, places those kept without it.
// code: what the answer allows from now on, as the card showed it apart (askOptions).
export type Answer = { said: string; code?: string; question: string; at: number; after?: { conv: string; turn: string } };

const KEY = 'workoffdesk.answered.';
const KEPT = 50;

export type Answers = ReturnType<typeof createAnswers>;

export function createAnswers(storage: KeyValue, journals: { view: (sessionId: string) => { conv: string | null; items: JournalItem[] } }) {
  const answersOf = (sessionId: string): Answer[] => {
    try {
      return JSON.parse(storage.getItem(KEY + sessionId) ?? '[]') as Answer[];
    } catch {
      return [];
    }
  };
  // Where the chat stands now: its conversation and the turn it ends with.
  const standing = (sessionId: string): Answer['after'] => {
    const { conv, items } = journals.view(sessionId);
    const turn = turns(items, items[0]?.pos ?? 0).at(-1)?.key;
    return conv && turn ? { conv, turn } : undefined;
  };
  return {
    answersOf,
    // Answers a question with post, and once that is taken keeps what was said, to go where the chat stood
    // when it was given; one not taken is not kept, and post's error is thrown.
    async give(sessionId: string, post: () => Promise<unknown>, said: string, question: string, code?: string): Promise<void> {
      const at = Date.now();
      const after = standing(sessionId);
      await post();
      const a: Answer = { said, ...(code && { code }), question: question.split('\n').find((l) => l.trim())?.trim() ?? '', at, ...(after && { after }) };
      try {
        storage.setItem(KEY + sessionId, JSON.stringify([...answersOf(sessionId), a].slice(-KEPT)));
      } catch {
        // Not kept.
      }
    },
  };
}

// Each answer after the turn the chat ended with when it was picked, keyed by that turn; those before any
// turn shown are left out, as the chat has not reached back to them. One kept without that turn goes after
// the last turn timed before it, the Mac's times read on this device's clock, which a phone's can be a minute from.
export function placeAnswers(answers: Answer[], shown: { key: string; at?: string }[], conv: string | null): Map<string, Answer[]> {
  const placed = new Map<string, Answer[]>();
  const keys = new Set(shown.map((t) => t.key));
  let last = -Infinity;
  const times = shown.map((t) => (t.at ? (last = Math.max(last, onThisClock(Date.parse(t.at)) || last)) : last));
  const timed = (a: Answer) => {
    let i = shown.length - 1;
    while (i >= 0 && times[i] > a.at) i--;
    return shown[i]?.key;
  };
  for (const a of answers) {
    const key = !a.after ? timed(a) : a.after.conv === conv && keys.has(a.after.turn) ? a.after.turn : undefined;
    if (key !== undefined) placed.set(key, [...(placed.get(key) ?? []), a]);
  }
  return placed;
}
