import { t } from '@workoffdesk/i18n';
import { ApiError, errorText, isAgent, MACHINE, type Api, type TermSession } from '../base/api';
import type { Answers } from '../chat/answered';
import { hasDialog, type Choices, type ModelChoice, type OnScreen } from '../model/chat';
import { anyOf, type Visibility } from '../base/platform';
import { seenWhileInFront } from './seen';
import type { Journals } from '../journal/journal';
import type { SessionView } from '../journal/journalRows';
import { ctrlChord, typedText } from '../composer/keys';
import { SHIFT_TAB, stepToMode } from '../composer/modes';
import { screenNow, screenRead } from '../journal/pushes';
import type { LinkState, SessionLink } from './sessionLink';
import type { SessionList } from './sessionList';
import { leaveSession } from './leave';
import { keysByRequest } from './keysByRequest';
import { queueActions } from './queueActions';
import type { SlashCommand } from '../composer/slash';
import { sessionState, startLocal, type SessionFacts, type SessionLocal, type SessionShown } from './sessionState';

export const TOAST_MS = 2500;
// How long what a press set off is waited on (a dialog showing, or the screen after a pick) before the screen
// lets go of it: on a slow line a trip there and back takes up to 8 s.
export const SHOWS_WITHIN_MS = 10_000;

export type SessionDeps = {
  api: Api;
  journals: Pick<Journals, 'view' | 'subscribe' | 'follow' | 'refresh' | 'rereadScreen' | 'apply' | 'send'>;
  links: { open(sessionId: string, page: Visibility, onState: (s: LinkState) => void): SessionLink };
  list: Pick<SessionList, 'current' | 'ended' | 'subscribe' | 'ends' | 'drop'>;
  seen: { markSeen(id: string): void };
  answers: Pick<Answers, 'give'>;
  readClipboard: () => Promise<string>;
};

export type SessionSnapshot = SessionLocal & SessionShown & { id: string; view: SessionView; known: TermSession | undefined; link: LinkState };

export type Session = ReturnType<typeof makeSession>;
export type Sessions = ReturnType<typeof createSessions>;

// One store per session id, the same one while any screen holds it.
export function createSessions(deps: SessionDeps) {
  const held = new Map<string, Session>();
  return {
    get(id: string): Session {
      let s = held.get(id);
      if (!s) {
        s = makeSession(id, deps, () => held.delete(id));
        held.set(id, s);
      }
      return s;
    },
  };
}

type Timed = 'toast' | 'commanding' | 'settling';

function makeSession(id: string, deps: SessionDeps, stopped: () => void) {
  const { api, journals, list, seen } = deps;
  const base = `/api/m/${MACHINE}/sessions/${id}`;
  const listeners = new Set<() => void>();
  const timers = new Map<Timed, ReturnType<typeof setTimeout>>();
  const inList = () => list.current()?.find((s) => s.id === id);
  let lastKnown = inList();
  // A session the list does not have when the screen opens may have ended before.
  const endedRecord = lastKnown ? null : list.ended(id);
  let local = startLocal();
  let link: LinkState = 'connecting';
  let line: SessionLink | null = null;
  let holders = 0;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let over = false;
  const stops: (() => void)[] = [];
  let following: (() => void) | null = null;
  let modelsAsked = false;
  // Looked at while any screen holding it is in front.
  const onScreen = anyOf();

  const facts = (): SessionFacts => {
    const known = lastKnown ?? endedRecord ?? undefined;
    return { view: journals.view(id), known, endedBefore: !!endedRecord && !lastKnown, link };
  };

  const retime = (was: SessionLocal) => {
    for (const k of ['toast', 'commanding', 'settling'] as const) {
      if (local[k] === was[k]) continue;
      clearTimeout(timers.get(k));
      timers.delete(k);
      if (local[k] !== null) timers.set(k, setTimeout(() => set({ [k]: null } as Partial<SessionLocal>), k === 'toast' ? TOAST_MS : SHOWS_WITHIN_MS));
    }
  };

  // What follows from the view now: the mode last read, a command or a pick whose screen has come.
  const follows = (f: SessionFacts, shown: SessionShown): SessionLocal => {
    const { screen } = f.view;
    let next = local;
    if (!shown.covered && screen.mode !== undefined && screen.mode !== next.lastMode) next = { ...next, lastMode: screen.mode };
    if (next.commanding && hasDialog(screen)) next = { ...next, commanding: null };
    if (next.settling && !f.view.screenStale && screen !== next.settling) next = { ...next, settling: null };
    return next;
  };

  const compute = (): SessionSnapshot => {
    const f = facts();
    let shown = sessionState(f, local);
    const next = follows(f, shown);
    if (next !== local) {
      const was = local;
      local = next;
      retime(was);
      shown = sessionState(f, local);
    }
    return { ...local, ...shown, id, known: f.known, link };
  };

  let snapshot = compute();

  const publish = () => {
    snapshot = compute();
    for (const l of [...listeners]) l();
  };

  function set(change: Partial<SessionLocal>) {
    if (over) return;
    const was = local;
    local = { ...local, ...change };
    retime(was);
    publish();
  }

  // The list or the journal said something: show it, and do what it now calls for.
  const changed = () => {
    publish();
    if (over || !running) return;
    const s = snapshot;
    if (isAgent(s.kind) && !following) following = journals.follow(id, onScreen);
    if (isAgent(s.kind) && !modelsAsked) {
      modelsAsked = true;
      api<{ models: ModelChoice[] }>(`${base}/models`).then(
        (r) => set({ models: r.models }),
        () => {},
      );
    }
    happened();
  };
  const happened = seenWhileInFront(seen, id, onScreen, () => snapshot.known?.lastActivity);

  // The line follows the list: one to a session that runs, none to a past one, a new one once it is gone on with.
  const listed = () => {
    const row = inList();
    if (row) lastKnown = row;
    if (!lastKnown?.past && (!line || (row && link === 'ended'))) {
      line?.close();
      link = 'connecting';
      line = deps.links.open(id, onScreen, (state) => {
        link = state;
        if (state === 'ended') list.ends(id);
        publish();
      });
    }
    changed();
  };
  const start = () => {
    running = true;
    stops.push(() => line?.close());
    stops.push(list.subscribe(listed));
    stops.push(journals.subscribe(id, changed));
    listed();
  };

  const stop = () => {
    if (holders) return;
    over = true;
    following?.();
    following = null;
    for (const f of stops.splice(0)) f();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    stopped();
  };

  const say = (text: string) => set({ toast: text });
  const reread = () => journals.rereadScreen(id);
  const giveBack = (text: string) => set({ refill: { text, n: (local.refill?.n ?? 0) + 1 } });
  // Claude's question has its cursor on the field for an answer of one's own: what is sent is that answer,
  // kept as a pick on a card is.
  const answerOwn = (c: Choices, text: string) => {
    const index = c.cursor;
    void deps.answers.give(id, () => api(`${base}/choices`, { method: 'POST', json: { index, label: c.options[index].label, text } }), text, c.context).then(
      reread,
      (e) => {
        say(e instanceof ApiError && e.status === 409 ? t.optionsChanged : errorText(e, t.notSentGiveBack, t.notSentGiveBack));
        giveBack(text);
        reread();
      },
    );
  };

  const pressByRequest = keysByRequest({ api, base, shown: (screen) => screenRead(id, screen), say });
  const send = (data: string) => {
    let out = data;
    if (local.ctrl && data) {
      set({ ctrl: false });
      const chord = ctrlChord(data[0]);
      if (chord) out = chord + data.slice(1);
    }
    if (line?.send(out)) return true;
    if (link === 'ended') return false;
    pressByRequest(out);
    return true;
  };
  const sendText = (text: string, enter: boolean) => send(typedText(text, enter, local.ctrl));

  const queue = queueActions({
    api,
    id,
    base,
    journals,
    say,
    giveBack,
    taking: (qid, on) => set({ taking: new Set([...local.taking].filter((x) => x !== qid).concat(on ? [qid] : [])) }),
  });

  // A key pressed in a card or dialog goes as a request, not on the line, which a slow phone line can hold
  // open and carrying nothing for seconds; the answer brings the screen after it.
  const postForScreen = (path: string, json: object) => {
    void api<{ screen: OnScreen }>(path, { method: 'POST', json }).then(
      (r) => {
        screenRead(id, r.screen);
        journals.refresh(id);
      },
      (e) => {
        set({ settling: null });
        say(errorText(e, t.notPressed, t.notConnectedTap));
      },
    );
    return true;
  };

  const stepMode = async (want: string | null) => {
    let pressed = true;
    const now = await stepToMode(want, {
      // The line pushes each change of the screen; only without it is the screen asked for.
      modeNow: async () => {
        const pushed = screenNow(id);
        if (pushed) return pushed.mode;
        return api<OnScreen>(`${base}/choices`).then(
          (x) => x.mode,
          () => undefined,
        );
      },
      press: () => (pressed = send(SHIFT_TAB)),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
    if (!pressed) return;
    reread();
    if (now !== want) say(t.modeNotSwitched);
  };

  return {
    id,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: (): SessionSnapshot => snapshot,
    // Held while a screen shows it (`page`: whether that screen is in front); it stops once none holds it.
    hold(page: Visibility): () => void {
      holders++;
      clearTimeout(stopTimer);
      const unhold = onScreen.add(page);
      if (!running && !over) start();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        unhold();
        if (--holders) return;
        stopTimer = setTimeout(stop, 0);
      };
    },
    send,
    sendText,
    armCtrl: (on: boolean) => set({ ctrl: on }),
    async paste() {
      try {
        const text = await deps.readClipboard();
        if (text) sendText(text, false);
      } catch {
        say(t.clipboardUnreadable);
      }
    },
    // A message goes through the Mac, which types it in now or holds it while Claude cannot take it. A bare
    // Enter, or a key with Ctrl armed, is a keystroke; while a panel is open it would go into the panel.
    sendMessage(text: string): boolean {
      if (journals.view(id).screen.panel) {
        set({ nudge: local.nudge + 1 });
        return false;
      }
      if (!text || local.ctrl) return sendText(text, true);
      const asked = journals.view(id).screen.choices;
      if (asked && !asked.submit && asked.options[asked.cursor]?.typed) {
        answerOwn(asked, text);
        return true;
      }
      journals.send(id, text).catch(() => {
        say(t.notSentGiveBack);
        giveBack(text);
      });
      return true;
    },
    press: (keys: string) => postForScreen(`${base}/keys`, { keys }),
    // However many Esc that takes (/config's search box takes one first).
    closeDialog: () => postForScreen(`${base}/close`, {}),
    // A pick was made: the dialog stays, busy, until the screen after it is read.
    settle() {
      set({ settling: journals.view(id).screen });
      reread();
    },
    reread,
    // Typed at the prompt by the Mac, one at a time, until the dialog it opens shows.
    runCommand(command: string) {
      if (local.commanding) return;
      set({ commanding: command });
      void api<{ ran: boolean; screen?: OnScreen }>(`${base}/command`, { method: 'POST', json: { command } }).then(
        (r) => {
          if (r.screen) screenRead(id, r.screen);
          journals.refresh(id);
          // Given what it takes (`/effort high`), it opens no dialog: once typed, it is done.
          if (r.ran && !command.includes(' ')) return;
          set({ commanding: null });
          if (!r.ran) say(t.serverErrors['dialog-open']);
        },
        (e) => {
          set({ commanding: null });
          say(errorText(e, t.notRun, t.notConnectedTap));
        },
      );
    },
    async switchMode(want: string | null) {
      if (local.switching) return;
      set({ switching: true });
      try {
        await stepMode(want);
      } finally {
        set({ switching: false });
      }
    },
    // Answered once the screen no longer offers it; reread so the offer goes from here at once.
    toBackground() {
      if (local.backgrounding) return;
      set({ backgrounding: true });
      void api<{ sent: boolean }>(`${base}/background`, { method: 'POST', json: {} })
        .then(
          (r) => !r.sent && say(t.backgroundOver),
          (e) => say(errorText(e, t.notBackgrounded, t.notConnectedTap)),
        )
        .finally(() => {
          set({ backgrounding: false });
          reread();
        });
    },
    ...queue,
    giveBack,
    dismissSuggestion: () => set({ dismissed: journals.view(id).screen.suggestion ?? null }),
    loadCommands: async () => (await api<{ commands: SlashCommand[] }>(`${base}/commands`)).commands,
    loadFiles: async () => (await api<{ files: string[] }>(`${base}/files`)).files,
    async end(): Promise<boolean> {
      if (local.ending) return false;
      set({ ending: true });
      try {
        await leaveSession(api, list, lastKnown ?? { id });
      } catch (e) {
        set({ ending: false });
        say(errorText(e, t.notEnded, t.endFailed));
        return false;
      }
      return true;
    },
    sayToast: say,
  };
}
