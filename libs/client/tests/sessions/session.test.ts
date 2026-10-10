import { t } from '@workoffdesk/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, errorText, NetworkError, type TermSession } from '../../src/base/api';
import type { Choices, OnScreen } from '../../src/model/chat';
import type { Message } from '../../src/journal/journalRows';
import { SHIFT_TAB } from '../../src/composer/modes';
import { createSessions, SHOWS_WITHIN_MS, TOAST_MS } from '../../src/sessions/session';
import { inFront } from '../../src/base/platform';
import { createSessionLinks } from '../../src/sessions/sessionLink';
import { aSession, fakeApi, fakeJournals, fakeList, fakeServer, fakeVisibility, flush } from '../helpers/fakes';

const BASE = '/api/m/local/sessions/s1';
const MODELS = `GET ${BASE}/models`;
const decoded = (d: string | Uint8Array) => (typeof d === 'string' ? d : new TextDecoder().decode(d));
const opened: Choices = { context: '/model', options: [{ label: 'Opus', detail: '' }], cursor: 0, opened: true };
const screen = (over: Partial<OnScreen>): OnScreen => ({ choices: null, panel: null, ...over });
const queued: Message = { id: 'm1', text: 'next', sentAt: 5, state: 'queued', ord: 1, item: null };
const q = { id: 'm1', text: 'next', at: 5 };

// front: whether the screen that holds the session is the one in front of the app.
function setup(o: { list?: TermSession[] | null; ended?: TermSession[]; front?: boolean } = {}) {
  const server = fakeServer();
  const app = fakeVisibility();
  const page = inFront(app, o.front ?? true);
  const links = createSessionLinks({ open: server.open, visibility: app, onSignedOut: () => {} });
  const api = fakeApi();
  const journals = fakeJournals();
  const list = fakeList(o.list === undefined ? [aSession()] : o.list, o.ended ?? []);
  const seen = { markSeen: vi.fn() };
  let clipboard: () => Promise<string> = async () => '';
  const sessions = createSessions({ api: api.api, journals, links, list, seen, answers: { give: (_id, post) => post().then(() => {}) }, readClipboard: () => clipboard() });
  const s = sessions.get('s1');
  const release = s.hold(page);
  const line = server.last();
  const typed = () => line.sent.filter((d) => typeof d !== 'string').map(decoded);
  return { server, app, page, api, journals, list, seen, sessions, s, release, line, typed, snap: () => s.getSnapshot(), useClipboard: (f: () => Promise<string>) => (clipboard = f) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createSessions', () => {
  describe('a held session', () => {
    it.each(['claude', 'codex'] as const)("opens a %s session's line, follows its journal and asks for its models", async (kind) => {
      const { line, journals, api, snap } = setup({ list: [aSession({ kind })] });
      expect(line.path).toBe(`${BASE}/ws`);
      expect(journals.asked).toContain('follow s1');
      expect(api.waiting()).toEqual([MODELS]);
      await api.answer(MODELS, { models: [{ value: 'opus', name: 'Opus', about: '', efforts: [] }] });
      expect(snap().models?.map((m) => m.value)).toEqual(['opus']);
    });

    it('follows no journal and asks for no models for a shell', () => {
      const { journals, api } = setup({ list: [aSession({ kind: 'shell' })] });
      expect(journals.asked).not.toContain('follow s1');
      expect(api.waiting()).toEqual([]);
    });

    it('marks it seen when held, when something new happens in it, and when left', async () => {
      const { seen, list, release } = setup();
      expect(seen.markSeen).toHaveBeenCalledTimes(1);
      list.set([aSession({ lastActivity: 2 })]);
      expect(seen.markSeen).toHaveBeenCalledTimes(2);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(seen.markSeen).toHaveBeenCalledTimes(3);
    });

    it('marks it seen only while its screen is in front: on coming in front, for what happens then, and on leaving the front', async () => {
      const { seen, list, page, app, release } = setup({ front: false });
      list.set([aSession({ lastActivity: 2 })]);
      expect(seen.markSeen).not.toHaveBeenCalled();
      page.setFront(true);
      expect(seen.markSeen).toHaveBeenCalledTimes(1);
      list.set([aSession({ lastActivity: 3 })]);
      expect(seen.markSeen).toHaveBeenCalledTimes(2);
      app.set(false);
      expect(seen.markSeen).toHaveBeenCalledTimes(3);
      list.set([aSession({ lastActivity: 4 })]);
      expect(seen.markSeen).toHaveBeenCalledTimes(3);
      page.setFront(false);
      app.set(true);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(seen.markSeen).toHaveBeenCalledTimes(3);
    });

    it('follows its journal and tells the Mac it is looked at only while some screen holding it is in front', async () => {
      const { s, journals, line, page } = setup({ front: false });
      line.opens();
      const followed = journals.pages.get('s1')!;
      expect(followed.visible()).toBe(false);
      expect(line.sent.filter((d) => typeof d === 'string')).toEqual([JSON.stringify({ type: 'visible', visible: false })]);
      const other = inFront(fakeVisibility(), true);
      const release = s.hold(other);
      expect(followed.visible()).toBe(true);
      expect(line.sent.at(-1)).toBe(JSON.stringify({ type: 'visible', visible: true }));
      other.setFront(false);
      expect(followed.visible()).toBe(false);
      page.setFront(true);
      expect(followed.visible()).toBe(true);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(followed.visible()).toBe(true);
      expect(journals.asked).not.toContain('unfollow s1');
    });

    it('keeps its line when held again at once (a screen mounted twice) and closes it when left', async () => {
      const { s, release, line, journals } = setup();
      release();
      const again = s.hold(inFront(fakeVisibility(), true));
      await vi.advanceTimersByTimeAsync(0);
      expect(line.closed).toBe(false);
      again();
      await vi.advanceTimersByTimeAsync(0);
      expect(line.closed).toBe(true);
      expect(journals.asked).toContain('unfollow s1');
    });

    it('makes a new session once the old one has stopped', async () => {
      const { s, sessions, release } = setup();
      expect(sessions.get('s1')).toBe(s);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(sessions.get('s1')).not.toBe(s);
    });

    it('keeps the row it last had once the list drops it', () => {
      const { list, snap } = setup();
      list.set([]);
      expect(snap().known?.title).toBe('Fix the build');
      expect(snap().ended).toBe(false);
    });

    it('shows it ended, as last seen, when it ended before the screen opened', () => {
      const { snap } = setup({ list: [], ended: [aSession({ title: 'Old one' })] });
      expect(snap().ended).toBe(true);
      expect(snap().known?.title).toBe('Old one');
    });
  });

  describe('keys', () => {
    it('go once the line is live; while it is down the toast says so and nothing is kept', () => {
      const { s, line, typed, snap } = setup();
      expect(s.send('x')).toBe(false);
      expect(snap().toast).toBe(t.notConnectedSend);
      line.opens();
      expect(s.send('y')).toBe(true);
      expect(typed()).toEqual(['y']);
    });

    it('turn into their Ctrl chord once when Ctrl is armed', () => {
      const { s, line, typed, snap } = setup();
      line.opens();
      s.armCtrl(true);
      s.send('c');
      expect(snap().ctrl).toBe(false);
      s.send('c');
      expect(typed()).toEqual(['\x03', 'c']);
    });

    it('paste what the clipboard holds, and say so when it cannot be read', async () => {
      const { s, line, typed, snap, useClipboard } = setup();
      line.opens();
      useClipboard(async () => 'ls');
      await s.paste();
      expect(typed()).toEqual(['\x1b[200~ls\x1b[201~']);
      useClipboard(async () => {
        throw new Error('denied');
      });
      await s.paste();
      expect(snap().toast).toBe(t.clipboardUnreadable);
    });

    it('let the toast go after a while', async () => {
      const { s, snap } = setup();
      s.sayToast('hello');
      await vi.advanceTimersByTimeAsync(TOAST_MS - 1);
      expect(snap().toast).toBe('hello');
      await vi.advanceTimersByTimeAsync(1);
      expect(snap().toast).toBeNull();
    });
  });

  describe('a message from the composer', () => {
    it('goes to the journal', () => {
      const { s, journals } = setup();
      expect(s.sendMessage('hi')).toBe(true);
      expect(journals.sent.map((m) => m.text)).toEqual(['hi']);
    });

    it('comes back to the composer when it could not go, and the toast says why', async () => {
      const { s, journals, snap } = setup();
      s.sendMessage('hi');
      journals.sent[0].fail(new Error('down'));
      await flush();
      expect(snap().toast).toBe(t.notSentGiveBack);
      expect(snap().refill).toEqual({ text: 'hi', n: 1 });
    });

    it('is held while a panel is open, nudging the bar that says so', () => {
      const { s, journals, snap } = setup();
      journals.show('s1', { screen: screen({ panel: { title: 'Status', body: '', hint: '' } }) });
      expect(s.sendMessage('hi')).toBe(false);
      expect(snap().nudge).toBe(1);
      expect(journals.sent).toEqual([]);
    });

    it.each([
      ['a bare Enter', '', false, '\r'],
      ['text with Ctrl armed', 'c', true, '\x03\r'],
    ])('is a keystroke when it is %s', (_, text, ctrl, keys) => {
      const { s, line, typed, journals } = setup();
      line.opens();
      if (ctrl) s.armCtrl(true);
      s.sendMessage(text);
      expect(typed()).toEqual([keys]);
      expect(journals.sent).toEqual([]);
    });
  });

  describe('a command from the pill', () => {
    const COMMAND = `POST ${BASE}/command`;

    it('runs once for two presses within one tick', async () => {
      const { s, api } = setup();
      await api.answer(MODELS, { models: [] });
      s.runCommand('/model');
      s.runCommand('/model');
      expect(api.waiting()).toEqual([COMMAND]);
    });

    it('runs again when pressed after the Mac said it could not run', async () => {
      const { s, api, snap } = setup();
      await api.answer(MODELS, { models: [] });
      s.runCommand('/model');
      await api.answer(COMMAND, { ran: false });
      expect(snap().toast).toBe(t.serverErrors['dialog-open']);
      expect(snap().commanding).toBeNull();
      s.runCommand('/model');
      expect(api.waiting()).toEqual([COMMAND]);
    });

    it('waits for the dialog it opens and lets go once it shows', async () => {
      const { s, api, snap, journals } = setup();
      s.runCommand('/model');
      await api.answer(COMMAND, { ran: true });
      expect(journals.asked).toContain('refresh s1');
      expect(snap().commanding).toBe('/model');
      journals.show('s1', { screen: screen({ choices: opened }) });
      expect(snap().commanding).toBeNull();
    });

    it(`lets go after ${SHOWS_WITHIN_MS} ms when the dialog never shows`, async () => {
      const { s, api, snap } = setup();
      s.runCommand('/model');
      await api.answer(COMMAND, { ran: true });
      await vi.advanceTimersByTimeAsync(SHOWS_WITHIN_MS);
      expect(snap().commanding).toBeNull();
    });

    it('is done once typed when it takes an argument, which opens no dialog', async () => {
      const { s, api, snap } = setup();
      s.runCommand('/effort high');
      await api.answer(COMMAND, { ran: true });
      expect(snap().commanding).toBeNull();
      expect(snap().toast).toBeNull();
    });

    it.each([
      ['refused', new ApiError(500, 'broken')],
      ['unreachable', new NetworkError('fetch failed')],
    ])('says why when it is %s', async (_, e) => {
      const { s, api, snap } = setup();
      s.runCommand('/model');
      await api.fail(COMMAND, e);
      expect(snap().toast).toBe(errorText(e, t.notRun, t.notConnectedTap));
      expect(snap().commanding).toBeNull();
    });
  });

  describe('a key in a Claude Code dialog', () => {
    const KEYS = `POST ${BASE}/keys`;

    it('goes as a request, holding the dialog until the screen after it is read', async () => {
      const { s, api, journals, snap } = setup();
      const up = screen({ choices: opened });
      journals.show('s1', { screen: up });
      expect(s.press('2')).toBe(true);
      expect(api.init(KEYS)?.json).toEqual({ keys: '2' });
      s.settle();
      expect(journals.asked).toContain('reread s1');
      journals.show('s1', { screen: screen({}), screenStale: true });
      expect(snap().dialog).toBe(up);
      expect(snap().dialogBusy).toBe(true);
      journals.show('s1', { screen: screen({}), screenStale: false });
      expect(snap().settling).toBeNull();
      expect(snap().dialog).toBeNull();
    });

    it('lets go of the dialog and says why when it fails', async () => {
      const { s, api, journals, snap } = setup();
      journals.show('s1', { screen: screen({ choices: opened }) });
      s.press('2');
      s.settle();
      const e = new NetworkError('fetch failed');
      await api.fail(KEYS, e);
      expect(snap().settling).toBeNull();
      expect(snap().toast).toBe(errorText(e, t.notPressed, t.notConnectedTap));
    });

    it('closes the dialog with one request however many Esc it takes', () => {
      const { s, api } = setup();
      s.closeDialog();
      expect(api.waiting()).toContain(`POST ${BASE}/close`);
    });
  });

  describe('the queue tray', () => {
    const MESSAGE = `POST ${BASE}/messages/m1`;
    const TAKE = `DELETE ${BASE}/messages/m1`;

    it('sends one now as an idempotent request and puts what the Mac answers in the journal', async () => {
      const { s, api, journals } = setup();
      const done = s.sendNow(q);
      expect(api.init(MESSAGE)).toMatchObject({ json: {}, idempotent: true });
      await api.answer(MESSAGE, { message: { t: 'message', key: 'm1', v: 3, body: {} } });
      expect(await done).toBe(true);
      expect(journals.asked).toContain('apply s1 m1');
    });

    it('moves one with a request that is not sent twice', () => {
      const { s, api } = setup();
      void s.move(q, -1);
      expect(api.init(MESSAGE)).toMatchObject({ json: { move: -1 } });
      expect(api.init(MESSAGE)?.idempotent).toBeUndefined();
    });

    it('reads the journal again when the Mac no longer holds the message (404)', async () => {
      const { s, api, journals, snap } = setup();
      const done = s.sendNow(q);
      await api.fail(MESSAGE, new ApiError(404, 'gone'));
      expect(await done).toBe(false);
      expect(journals.asked).toContain('refresh s1');
      expect(snap().toast).toBe(t.alreadySent);
    });

    it('takes one back at once and hands its text to the composer to change', async () => {
      const { s, api, journals, snap } = setup();
      journals.show('s1', { messages: [queued] });
      expect(snap().queued.map((x) => x.id)).toEqual(['m1']);
      const done = s.unsend(q, true);
      expect(snap().queued).toEqual([]);
      await api.answer(TAKE, { text: 'next', message: null });
      expect(await done).toBe(true);
      expect(snap().refill).toEqual({ text: 'next', n: 1 });
    });

    it('shows one again that could not be taken back', async () => {
      const { s, api, journals, snap } = setup();
      journals.show('s1', { messages: [queued] });
      const done = s.unsend(q, false);
      const e = new ApiError(500, '');
      await api.fail(TAKE, e);
      expect(await done).toBe(false);
      expect(snap().queued.map((x) => x.id)).toEqual(['m1']);
      expect(snap().toast).toBe(errorText(e, t.deleteFailed, t.deleteFailed));
    });
  });

  describe('the permission mode', () => {
    const CHOICES = `GET ${BASE}/choices`;

    it('is stepped with Shift+Tab until the screen shows the one wanted', async () => {
      const { s, api, line, typed, snap, journals } = setup();
      line.opens();
      const done = s.switchMode('plan');
      expect(snap().switching).toBe(true);
      await api.answer(CHOICES, screen({ mode: null }));
      expect(typed()).toEqual([SHIFT_TAB]);
      await vi.advanceTimersByTimeAsync(150);
      await api.answer(CHOICES, screen({ mode: 'plan' }));
      await done;
      expect(snap().switching).toBe(false);
      expect(snap().toast).toBeNull();
      expect(journals.asked).toContain('reread s1');
    });

    it('says so when the line is down and nothing could be pressed', async () => {
      const { s, api, snap } = setup();
      const done = s.switchMode('plan');
      await api.answer(CHOICES, screen({ mode: null }));
      await done;
      expect(snap().toast).toBe(t.notConnectedSend);
      expect(snap().switching).toBe(false);
    });
  });

  describe('ending the session', () => {
    const END = `DELETE ${BASE}`;

    it('keeps it and says why when the Mac refuses', async () => {
      const { s, api, snap, list } = setup();
      const done = s.end();
      expect(snap().ending).toBe(true);
      const e = new ApiError(500, '');
      await api.fail(END, e);
      expect(await done).toBe(false);
      expect(snap().ending).toBe(false);
      expect(snap().toast).toBe(errorText(e, t.notEnded, t.endFailed));
      expect(list.dropped).toEqual([]);
    });

    it('drops it from the list once ended', async () => {
      const { s, api, list } = setup();
      const done = s.end();
      await api.answer(END);
      expect(await done).toBe(true);
      expect(list.dropped).toEqual(['s1']);
    });
  });

  describe('a session left while the Mac is answering', () => {
    it('changes nothing and tells no one when the answer comes', async () => {
      const { s, api, release } = setup();
      s.runCommand('/model');
      const before = s.getSnapshot();
      const told = vi.fn();
      s.subscribe(told);
      release();
      await vi.advanceTimersByTimeAsync(0);
      await api.answer(`POST ${BASE}/command`, { ran: false });
      expect(s.getSnapshot()).toBe(before);
      expect(told).not.toHaveBeenCalled();
    });
  });

});
