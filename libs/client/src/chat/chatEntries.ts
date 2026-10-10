import type { ClaudeStatus, SessionKind } from '../base/api';
import { placeAnswers, type Answer } from './answered';
import { rows, turns, type Ask, type Choices, type ToolTurn, type Turn } from '../model/chat';
import { onThisClock } from '../base/clock';
import { shownEarlier } from './images';
import { onShow, type Background, type Message, type SessionView } from '../journal/journalRows';

// A row of the chat, first to last, with what the app needs to draw it.
export type ChatEntry =
  | { kind: 'tools'; key: string; tools: (ToolTurn & { key: string })[]; going: boolean; end: string | undefined }
  | { kind: 'turn'; key: string; turn: Turn; repeated: Set<string> | undefined; sent: boolean; last: boolean; rewind: boolean; retry: boolean }
  | { kind: 'answer'; key: string; answer: Answer }
  | { kind: 'empty'; key: 'empty' }
  | { kind: 'live'; key: 'live'; text: string }
  | { kind: 'bubble'; key: string; message: Message }
  | { kind: 'failed'; key: 'failed' }
  | { kind: 'background'; key: 'background'; running: Background[] }
  | { kind: 'working'; key: 'working'; since: number | null }
  | { kind: 'ask'; key: string; ask: Ask }
  | { kind: 'choice'; key: 'choice'; choices: Choices }
  | { kind: 'tick'; key: string; choices: Choices }
  | { kind: 'waiting'; key: 'waiting' };

// queued: how many messages the tray shows; dialog: one of Claude Code's dialogs is up, and has the questions.
export type ChatInput = {
  kind: SessionKind | null;
  view: SessionView;
  status: ClaudeStatus | null | undefined;
  answers: Answer[];
  queued: number;
  dialog: boolean;
};

// The chat from first to last. inEntry: the entry each turn is drawn in.
export function chatEntries(input: ChatInput): { entries: ChatEntry[]; shown: Turn[]; inEntry: Map<string, string> } {
  const { view, status } = input;
  const { screen } = view;
  const shown = turns(view.items, view.items[0]?.pos ?? 0);
  const repeats = shownEarlier(shown);
  const { sent, bubbles } = onShow(view, shown);
  const answered = placeAnswers(input.answers, shown, view.conv);
  const drawn = rows(shown, status === 'working');
  const order = new Map(shown.map((x, i) => [x.key, i]));
  const lastMine = shown.findLast((x) => x.k === 'user' && !sent.has(x.key))?.key;
  const quiet = status === 'idle' && !screen.choices && !screen.panel;
  const entries: ChatEntry[] = [];
  const inEntry = new Map<string, string>();
  const chose = (key: string) => {
    for (const answer of answered.get(key) ?? []) entries.push({ kind: 'answer', key: `answer-${answer.at}`, answer });
  };

  drawn.forEach((r, n) => {
    if (r.k === 'tools') {
      const next = drawn[n + 1];
      entries.push({ kind: 'tools', key: r.key, tools: r.tools, going: r.going, end: next?.k === 'one' && 'at' in next.t ? next.t.at : undefined });
      for (const x of r.tools) {
        inEntry.set(x.key, r.key);
        chose(x.key);
      }
      return;
    }
    const turn = r.t;
    const i = order.get(turn.key)!;
    inEntry.set(turn.key, turn.key);
    entries.push({
      kind: 'turn',
      key: turn.key,
      turn,
      repeated: repeats.get(turn.key),
      sent: sent.has(turn.key),
      last: turn.k === 'text' && (i === shown.length - 1 ? status !== 'working' : ['user', 'changes'].includes(shown[i + 1].k)),
      rewind: input.kind === 'claude' && turn.key === lastMine && quiet,
      retry: n === drawn.length - 1 && quiet && !input.queued,
    });
    chose(turn.key);
  });

  if (view.synced && !shown.length && !input.queued && !bubbles.length) entries.push({ kind: 'empty', key: 'empty' });
  if (view.live) entries.push({ kind: 'live', key: 'live', text: view.live });
  // Claude takes a message sent during its turn between two steps, so what it is writing now comes before it.
  for (const message of bubbles) entries.push({ kind: 'bubble', key: `message-${message.id}`, message });
  if (view.failed) entries.push({ kind: 'failed', key: 'failed' });
  if (view.background.length) entries.push({ kind: 'background', key: 'background', running: view.background });
  if (status === 'working') entries.push({ kind: 'working', key: 'working', since: view.workingSince === null ? null : onThisClock(view.workingSince) });

  // What Claude Code said it waits on comes first; the screen shows the same prompt meanwhile. A dialog
  // opened while Claude works (/model) has the keyboard as much as a question does.
  const asking = status === 'waiting' || status === 'working';
  const ask = screen.asks?.[0];
  const { choices } = screen;
  if (input.dialog) return { entries, shown, inEntry };
  if (ask) entries.push({ kind: 'ask', key: `ask-${ask.id}`, ask });
  else if (asking && choices && !choices.submit) entries.push({ kind: 'choice', key: 'choice', choices });
  // Another question is another set of ticks.
  else if (asking && choices?.submit) entries.push({ kind: 'tick', key: ['tick', choices.context, ...choices.options.map((o) => o.label)].join('\n'), choices });
  else if (status === 'waiting') entries.push({ kind: 'waiting', key: 'waiting' });
  return { entries, shown, inEntry };
}
