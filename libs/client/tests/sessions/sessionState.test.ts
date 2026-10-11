import { t } from '@workoffdesk/i18n';
import { describe, expect, it } from 'vitest';
import type { ClaudeStatus } from '../../src/base/api';
import type { Choices, OnScreen } from '../../src/model/chat';
import { emptyView, type Message, type SessionView } from '../../src/journal/journalRows';
import { queueWhy, sessionState, startLocal, type SessionFacts, type SessionLocal } from '../../src/sessions/sessionState';
import { aSession } from '../helpers/fakes';

const view = (over: Partial<SessionView> = {}): SessionView => ({ ...emptyView, synced: true, ...over });
const facts = (over: Partial<SessionFacts> = {}): SessionFacts => ({ view: view(), known: aSession(), endedBefore: false, link: 'live', ...over });
const local = (over: Partial<SessionLocal> = {}): SessionLocal => ({ ...startLocal(), ...over });
const screen = (over: Partial<OnScreen>): OnScreen => ({ choices: null, panel: null, ...over });
const opened: Choices = { context: '/model', options: [{ label: 'Opus', detail: '' }], cursor: 0, opened: true };
const queuedMessage: Message = { id: 'm1', text: 'next', sentAt: 5, state: 'queued', ord: 1, item: null };

describe('queueWhy', () => {
  it.each<[ClaudeStatus | null, string]>([
    ['starting', t.queueWhenStarted('Codex')],
    ['compacting', t.queueAfterCompact],
    ['waiting', t.queueAfterWaiting('Codex')],
    ['working', t.queueAfterTurn('Codex')],
    ['idle', t.queueNow],
    ['ended', t.queueWhenContinued('Codex')],
    [null, t.queueNow],
  ])('%s: %s', (status, said) => {
    expect(queueWhy(status, 'Codex')).toBe(said);
  });
});

describe('sessionState', () => {
  describe('when the session has ended', () => {
    it.each<[string, Partial<SessionFacts>]>([
      ['its line says it ended', { link: 'ended' }],
      ['the Mac has no such session', { view: view({ gone: true }) }],
      ['it had ended before the screen opened', { endedBefore: true }],
      ['the Mac keeps it as past', { known: aSession({ past: true }), link: 'connecting' }],
    ])('is ended when %s, and shows nothing to type into', (_, f) => {
      const s = sessionState(facts({ view: view({ status: 'working' }), ...f }), local());
      expect(s.ended).toBe(true);
      expect(s.status).toBe('ended');
      expect(s.header).toEqual({ kind: 'claude', status: 'ended' });
    });

    it('is not ended while the list and the journal say it runs', () => {
      expect(sessionState(facts(), local()).ended).toBe(false);
    });
  });

  describe('when its agent quit', () => {
    it.each(['claude', 'codex'] as const)('says so for %s while the session is still on the Mac', (kind) => {
      const s = sessionState(facts({ view: view({ status: 'ended' }), known: aSession({ kind }) }), local());
      expect([s.quit, s.ended]).toEqual([true, false]);
    });

    it.each<[string, Partial<SessionFacts>]>([
      ['its agent runs', { view: view({ status: 'idle' }) }],
      ['the session is a shell', { view: view({ status: 'ended' }), known: aSession({ kind: 'shell', status: null }) }],
      ['the session ended with it', { view: view({ status: 'ended' }), link: 'ended' }],
      ['the list does not have the session yet', { view: view({ status: 'ended' }), known: undefined }],
    ])('does not say so when %s', (_, f) => {
      expect(sessionState(facts(f), local()).quit).toBe(false);
    });
  });

  describe('status', () => {
    it("is the journal's once it has one", () => {
      expect(sessionState(facts({ view: view({ status: 'working' }) }), local()).status).toBe('working');
    });

    it("is the list's until the journal has said", () => {
      expect(sessionState(facts({ known: aSession({ status: 'waiting' }) }), local()).status).toBe('waiting');
    });

    it('says only that a terminal is reconnecting while its line is down', () => {
      expect(sessionState(facts({ known: aSession({ kind: 'shell', status: null }), link: 'reconnecting' }), local()).header).toBe('reconnecting');
    });

    // A chat goes on coming by asking the Mac while its line is down.
    it('says a chat is reconnecting only once asking the Mac fails', () => {
      expect(sessionState(facts({ link: 'reconnecting' }), local()).header).toMatchObject({ kind: 'claude', status: 'idle' });
      expect(sessionState(facts({ view: view({ failed: true }) }), local()).header).toBe('reconnecting');
    });

    it('is unknown, with no kind, before the list has the session', () => {
      const s = sessionState(facts({ known: undefined }), local());
      expect(s.kind).toBeNull();
      expect(s.header).toBeUndefined();
    });
  });

  describe('permission mode', () => {
    it('is the one on screen while nothing covers the prompt', () => {
      expect(sessionState(facts({ view: view({ screen: screen({ mode: 'plan' }) }) }), local({ lastMode: 'auto' })).mode).toBe('plan');
    });

    it.each<[string, Partial<SessionView>]>([
      ['a panel', { screen: screen({ panel: { title: 'Status', body: '', hint: '' } }) }],
      ['a question', { screen: screen({ choices: { ...opened, opened: undefined } }) }],
      ['Claude waiting on the person', { status: 'waiting' }],
    ])('is the last one read while %s covers the prompt', (_, v) => {
      const s = sessionState(facts({ view: view(v) }), local({ lastMode: 'plan' }));
      expect(s.covered).toBe(true);
      expect(s.mode).toBe('plan');
    });
  });

  describe('dialog', () => {
    it('is the screen while a picker the person opened is up', () => {
      const on = screen({ choices: opened });
      const s = sessionState(facts({ view: view({ screen: on }) }), local());
      expect(s.dialog).toBe(on);
      expect(s.dialogBusy).toBe(false);
    });

    it('is the one being settled, busy, until the screen after the pick is read', () => {
      const was = screen({ choices: opened });
      const s = sessionState(facts({ view: view({ screenStale: true }) }), local({ settling: was }));
      expect(s.dialog).toBe(was);
      expect(s.dialogBusy).toBe(true);
    });

    it('is none for a question Claude asks, which stays in the chat', () => {
      expect(sessionState(facts({ view: view({ screen: screen({ choices: { ...opened, opened: undefined } }) }) }), local()).dialog).toBeNull();
    });
  });

  describe('suggestion', () => {
    const offering = view({ status: 'idle', screen: screen({ suggestion: 'run the tests' }) });

    it.each(['claude', 'codex'] as const)('is offered while the %s agent is idle', (kind) => {
      expect(sessionState(facts({ view: offering, known: aSession({ kind }) }), local()).suggestion).toBe('run the tests');
    });

    it.each<[string, Partial<SessionFacts>, Partial<SessionLocal>]>([
      ['it was turned down', {}, { dismissed: 'run the tests' }],
      ['Claude works', { view: { ...offering, status: 'working' } }, {}],
      ['the session is a shell', { known: aSession({ kind: 'shell' }) }, {}],
    ])('is not offered once %s', (_, f, l) => {
      expect(sessionState(facts({ view: offering, ...f }), local(l)).suggestion).toBeNull();
    });
  });

  describe('queue', () => {
    it('lists what the Mac holds, leaving out what is being taken back', () => {
      const v = view({ messages: [queuedMessage] });
      expect(sessionState(facts({ view: v }), local()).queued.map((q) => q.id)).toEqual(['m1']);
      expect(sessionState(facts({ view: v }), local({ taking: new Set(['m1']) })).queued).toEqual([]);
    });

    it('can be sent now only while Claude works and nothing covers the prompt', () => {
      expect(sessionState(facts({ view: view({ status: 'working' }) }), local()).canSendNow).toBe(true);
      expect(sessionState(facts({ view: view({ status: 'idle' }) }), local()).canSendNow).toBe(false);
      expect(sessionState(facts({ view: view({ status: 'working', screen: screen({ choices: opened }) }) }), local()).canSendNow).toBe(false);
    });
  });
});
