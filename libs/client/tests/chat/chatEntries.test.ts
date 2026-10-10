import { describe, expect, it } from 'vitest';
import type { Answer } from '../../src/chat/answered';
import type { Ask, ChatItem, Choices, OnScreen } from '../../src/model/chat';
import { chatEntries, type ChatInput } from '../../src/chat/chatEntries';
import { emptyView, type JournalItem, type Message, type SessionView } from '../../src/journal/journalRows';

const at = (min: number) => `2026-10-07T10:${String(min).padStart(2, '0')}:00Z`;
const items = (...list: ChatItem[]): JournalItem[] => list.map((i, pos) => ({ ...i, itemId: `i${pos}`, pos, conv: 'c' }));
const asked = items({ k: 'user', text: 'fix it', at: at(0) }, { k: 'text', text: 'Fixed.', at: at(1) });
const view = (over: Partial<SessionView> = {}): SessionView => ({ ...emptyView, synced: true, items: asked, ...over });
const input = (over: Partial<ChatInput> = {}): ChatInput => ({ kind: 'claude', view: view(), status: 'idle', answers: [], queued: 0, dialog: false, ...over });
const kinds = (i: ChatInput) => chatEntries(i).entries.map((e) => e.kind);
const turn = (i: ChatInput, key: string) => {
  const e = chatEntries(i).entries.find((x) => x.key === key);
  if (e?.kind !== 'turn') throw new Error(`no turn ${key}`);
  return e;
};
const screen = (over: Partial<OnScreen>): OnScreen => ({ choices: null, panel: null, ...over });
const question: Choices = { context: 'Go on?', options: [{ label: 'Yes', detail: '' }], cursor: 0 };
const ask: Ask = { id: 'a1', kind: 'permission', tool: 'Bash', title: 'Run ls', detail: '', always: null };

describe('chatEntries', () => {
  describe('turns', () => {
    it('gives each turn an entry, in order', () => {
      expect(kinds(input())).toEqual(['turn', 'turn']);
    });

    it('puts calls made one after another in one row that each call can be found in', () => {
      const v = view({
        items: items(
          { k: 'user', text: 'look', at: at(0) },
          { k: 'tool', id: 't1', name: 'Read', summary: '/a' },
          { k: 'tool', id: 't2', name: 'Read', summary: '/b' },
          { k: 'text', text: 'Done.', at: at(2) },
        ),
      });
      const { entries, inEntry } = chatEntries(input({ view: v }));
      expect(entries.map((e) => e.kind)).toEqual(['turn', 'tools', 'turn']);
      expect(entries[1]).toMatchObject({ kind: 'tools', key: 't1', end: at(2), going: false });
      expect(inEntry.get('t2')).toBe('t1');
    });

    it("marks which reply is the last of its turn, but not Claude's words while it still works", () => {
      expect(turn(input(), '1').last).toBe(true);
      expect(turn(input({ status: 'working' }), '1').last).toBe(false);
    });

    it('shows what was picked on a card after the turn it followed', () => {
      const a: Answer = { said: 'Yes', question: 'Go on?', at: Date.parse(at(2)) };
      expect(chatEntries(input({ answers: [a] })).entries.map((e) => e.key)).toEqual(['0', '1', `answer-${a.at}`]);
    });
  });

  describe('the Continue entry', () => {
    it('is offered while Claude is idle with nothing on screen and nothing in the tray', () => {
      expect(turn(input(), '1').retry).toBe(true);
    });

    it.each<[string, Partial<ChatInput>]>([
      ['anything is in the tray', { queued: 1 }],
      ['Claude works', { status: 'working' }],
      ['a panel is open', { view: view({ screen: screen({ panel: { title: 'Status', body: '', hint: '' } }) }) }],
      ['Claude asks a question', { view: view({ screen: screen({ choices: question }) }) }],
    ])('is not offered while %s', (_, over) => {
      expect(turn(input(over), '1').retry).toBe(false);
    });
  });

  describe('the rewind entry', () => {
    it('is offered on the last message the person sent while Claude is idle', () => {
      expect(turn(input(), '0').rewind).toBe(true);
      expect(turn(input({ status: 'working' }), '0').rewind).toBe(false);
    });

    it('is not offered in Codex, which has no /rewind', () => {
      expect(turn(input({ kind: 'codex' }), '0').rewind).toBe(false);
    });
  });

  describe('the empty state', () => {
    const none = view({ items: [] });

    it('shows once the Mac has answered with nothing', () => {
      expect(kinds(input({ view: none }))).toEqual(['empty']);
    });

    it.each<[string, Partial<ChatInput>]>([
      ['anything is in the tray', { queued: 1 }],
      ['the Mac has not answered yet', { view: { ...none, synced: false } }],
    ])('does not show while %s', (_, over) => {
      expect(kinds(input({ view: none, ...over }))).toEqual([]);
    });
  });

  describe('below the turns', () => {
    const delivered: Message = { id: 'm1', text: 'and this', sentAt: Date.parse(at(3)), state: 'delivered', ord: null, item: null };

    it('shows what Claude is writing, messages on their way, a cannot-read note and background tasks, in that order', () => {
      const v = view({ live: 'Looking…', messages: [delivered], failed: true, background: [{ id: 'b1', label: 'npm test' }] });
      expect(kinds(input({ view: v })).slice(2)).toEqual(['live', 'bubble', 'failed', 'background']);
    });

    it('times the turn from when the Mac saw Claude start, not from the last message sent', () => {
      const e = chatEntries(input({ status: 'working', view: view({ workingSince: 99 }) })).entries.at(-1);
      expect(e).toEqual({ kind: 'working', key: 'working', since: 99 });
    });
  });

  describe('what Claude waits on', () => {
    it('is the permission it asked for first', () => {
      expect(kinds(input({ status: 'waiting', view: view({ screen: screen({ asks: [ask], choices: question }) }) })).at(-1)).toBe('ask');
    });

    it('is its question while it waits', () => {
      expect(kinds(input({ status: 'waiting', view: view({ screen: screen({ choices: question }) }) })).at(-1)).toBe('choice');
    });

    it('is a set of ticks, keyed by what it asks', () => {
      const ticks = { ...question, submit: 'Submit' };
      const e = chatEntries(input({ status: 'waiting', view: view({ screen: screen({ choices: ticks }) }) })).entries.at(-1);
      expect(e).toMatchObject({ kind: 'tick', key: 'tick\nGo on?\nYes' });
    });

    it('is a note to look at the screen when it waits on nothing the chat can show', () => {
      expect(kinds(input({ status: 'waiting' })).at(-1)).toBe('waiting');
    });

    it('is none of these while a Claude Code dialog is up', () => {
      expect(kinds(input({ status: 'waiting', dialog: true, view: view({ screen: screen({ asks: [ask] }) }) }))).toEqual(['turn', 'turn']);
    });
  });
});
