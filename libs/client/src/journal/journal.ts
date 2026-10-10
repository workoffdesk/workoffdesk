import { ApiError, MACHINE, type Api } from '../base/api';
import type { Visibility } from '../base/platform';
import { askDue, behindMac, caughtUp, forgetJournal, haveJournal, onHeads, onPush, pollDelay, type Push } from './pushes';
import { applyRows, emptyCopy, emptyView, viewOf, type Copy, type Flags, type JournalRow, type JournalStore, type JournalSync, type Message, type SessionView } from './journalRows';

// How often to ask the Mac while it pushes nothing.
const POLL_MS = 1200;
// Reads failing for less than this are a blip and show nothing.
const FAILED_AFTER_MS = 10_000;

export function createJournals(config: { api: Api; visibility: Visibility; newId: () => string; store?: JournalStore }) {
  const { api, visibility, store } = config;
  type Session = Flags & {
    id: string;
    copy: Copy;
    view: SessionView;
    listeners: Set<() => void>;
    // Asks the Mac now, while the page follows the session.
    read: (() => void) | null;
    // The last message sent from here, the next one leaves after it.
    lastSend: Promise<unknown>;
    arrived: Map<string, () => void>;
    // Messages being posted in this run of the app.
    posting: Set<string>;
  };
  const sessions = new Map<string, Session>();
  const base = (id: string) => `/api/m/${MACHINE}/sessions/${id}`;

  const session = (id: string): Session => {
    let s = sessions.get(id);
    if (!s) {
      s = {
        id,
        copy: emptyCopy(),
        view: emptyView,
        synced: false,
        failed: false,
        gone: false,
        loadingOlder: false,
        screenHidden: false,
        listeners: new Set(),
        read: null,
        lastSend: Promise.resolve(),
        arrived: new Map(),
        posting: new Set(),
      };
      sessions.set(id, s);
    }
    return s;
  };
  const changed = (s: Session) => {
    s.view = viewOf(s.id, s.copy, s);
    for (const l of s.listeners) l();
  };
  const apply = (id: string, rows: JournalRow[], reset = false) => {
    const s = session(id);
    applyRows(s.copy, rows, reset);
    for (const r of rows) {
      if (r.t === 'state' && (r.key === 'screen' || r.key === 'asks')) s.screenHidden = false;
      if (r.t !== 'message' || !r.v) continue;
      s.arrived.get(r.key)?.();
      s.arrived.delete(r.key);
    }
    const { epoch, v, older } = s.copy;
    store?.write(id, { epoch, v, older }, rows, reset);
    changed(s);
  };
  const synced = (id: string, sync: JournalSync) => {
    const s = session(id);
    if (sync.reset) s.copy.older = sync.older ?? null;
    s.copy.epoch = sync.epoch;
    s.copy.v = sync.v;
    apply(id, sync.rows, !!sync.reset);
  };

  // Posts a message this device holds as sending, after the one before it has reached the Mac, so they
  // arrive in order; tried again while the Mac side restarts or the tunnel blinks (api.ts). Under its qid
  // the Mac takes it once however often it comes.
  const post = (id: string, m: Message): Promise<void> => {
    const s = session(id);
    s.posting.add(m.id);
    const posted = s.lastSend.then(() =>
      api<{ message: JournalRow | null }>(`${base(id)}/messages`, { method: 'POST', json: { text: m.text, id: m.id }, idempotent: true }),
    );
    const arrived = new Promise<void>((resolve) => s.arrived.set(m.id, resolve));
    s.lastSend = Promise.race([posted.catch(() => {}), arrived]);
    return posted
      .then(
        (r) => {
          if (r.message) apply(id, [r.message]);
        },
        (e: unknown) => {
          s.arrived.delete(m.id);
          throw e;
        },
      )
      .finally(() => s.posting.delete(m.id));
  };
  // A message the Mac has not said it has is no longer kept; false when it has said so after all.
  const unsent = (id: string, qid: string): boolean => {
    const s = session(id);
    if (s.copy.messages.get(qid)?.v !== 0) return false;
    s.copy.messages.delete(qid);
    store?.remove(id, qid);
    changed(s);
    return true;
  };

  // Asks the Mac for what the copy is missing, page after page.
  const fetchMissing = async (id: string) => {
    const s = session(id);
    for (;;) {
      const sync = await api<JournalSync>(`${base(id)}/journal?epoch=${encodeURIComponent(s.copy.epoch ?? '')}&v=${s.copy.v}`);
      synced(id, sync);
      if (!sync.more) break;
    }
    haveJournal(id, { epoch: s.copy.epoch ?? '', v: s.copy.v });
  };

  return {
    // The session's view, the same object until something in it changes.
    view: (id: string): SessionView => session(id).view,

    subscribe(id: string, listener: () => void): () => void {
      const s = session(id);
      s.listeners.add(listener);
      return () => s.listeners.delete(listener);
    },

    // Keeps the copy up to date while the page is open: what the line pushes, and asking the Mac when the
    // line is quiet, behind, or the page comes back to the front.
    follow(id: string): () => void {
      const s = session(id);
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let asked = 0;
      let failingSince: number | null = null;
      let reading = false;
      let again = false;
      let resumed = false;
      // Sending when the app stopped, and not had by the Mac as the copy now says: sent again, and dropped
      // only if the Mac turns it down.
      const resume = () => {
        resumed = true;
        for (const m of s.copy.messages.values())
          if (m.v === 0 && !s.posting.has(m.body.id))
            post(id, m.body).catch((e: unknown) => {
              if (e instanceof ApiError && e.status >= 400 && e.status < 500) unsent(id, m.body.id);
            });
      };
      const flags = (f: Partial<Pick<Flags, 'synced' | 'failed' | 'gone' | 'screenHidden'>>) => {
        if (Object.entries(f).every(([k, v]) => s[k as keyof typeof f] === v)) return;
        Object.assign(s, f);
        changed(s);
      };
      const read = async (asking = true) => {
        clearTimeout(timer);
        if (reading) {
          again = true;
          return;
        }
        if (visibility.visible() && (asking || askDue(id, asked))) {
          reading = true;
          asked = Date.now();
          const hidden = s.screenHidden;
          try {
            await fetchMissing(id);
            if (!resumed && !stopped) resume();
            failingSince = null;
            // The screen as read after the card was pressed, whether or not it changed.
            flags({ synced: true, failed: false, ...(hidden && { screenHidden: false }) });
          } catch (e) {
            if (e instanceof ApiError && e.status === 404) flags({ gone: true, failed: false });
            else {
              failingSince ??= Date.now();
              if (Date.now() - failingSince >= FAILED_AFTER_MS) flags({ failed: true });
            }
          } finally {
            reading = false;
          }
        }
        // A session the Mac no longer has has nothing more to say.
        if (stopped || s.gone) return;
        if (again) {
          again = false;
          return void read();
        }
        timer = setTimeout(() => void read(false), pollDelay(id, POLL_MS));
      };
      flags({ synced: caughtUp(id, s.copy), failed: false });
      // Synced once any line shows the copy has what the Mac has: the answer to an ask, a push, or the heads.
      const reached = () => void (caughtUp(id, s.copy) && flags({ synced: true }));
      const unheads = onHeads(() => {
        if (s.view.behind !== behindMac(id, s.copy)) changed(s);
        reached();
      });
      const unpush = onPush(id, (p: Push) => {
        if (p.type !== 'journal' || stopped) return;
        if (p.reset && p.epoch) {
          synced(id, { epoch: p.epoch, v: p.v, rows: p.rows, more: !!p.more, reset: true, older: p.older });
          flags({ synced: true });
        } else if ((!p.epoch || p.epoch === s.copy.epoch) && p.from === s.copy.v) {
          s.copy.v = p.v;
          apply(id, p.rows);
          // The last page of a catch-up (it says the epoch) leaves the copy where the Mac is, as an ask's answer does.
          if (p.epoch && !p.more) flags({ synced: true });
          else reached();
        } else void read();
      });
      const unlisten = visibility.onChange(() => visibility.visible() && void read());
      s.read = () => void read();
      void (async () => {
        if (store && !s.copy.epoch) {
          const kept = await store.load(id).catch(() => null);
          if (kept && !stopped && !s.copy.epoch) {
            s.copy = { ...emptyCopy(), epoch: kept.epoch, v: kept.v, older: kept.older };
            applyRows(s.copy, kept.rows);
            s.synced = caughtUp(id, s.copy);
            changed(s);
          }
        }
        if (stopped) return;
        // The line catches a kept copy up too, and may well be first across a slow line.
        if (s.copy.epoch) haveJournal(id, { epoch: s.copy.epoch, v: s.copy.v });
        void read();
      })();
      return () => {
        stopped = true;
        clearTimeout(timer);
        unheads();
        unpush();
        unlisten();
        s.read = null;
        forgetJournal(id);
      };
    },

    // Asks the Mac now, as an answer that changed what it holds came in.
    refresh(id: string): void {
      session(id).read?.();
    },

    // A card was pressed: what it was drawn from is gone until the screen is read again.
    rereadScreen(id: string): void {
      const s = session(id);
      s.screenHidden = true;
      changed(s);
      s.read?.();
    },

    // The conversation's turns before the oldest held, a page of them. beforeShow runs just before they go
    // in, while the page still shows it as it was.
    async older(id: string, beforeShow?: () => void): Promise<void> {
      const s = session(id);
      const conv = s.view.conv;
      if (s.copy.older === null || s.loadingOlder || !conv) return;
      s.loadingOlder = true;
      changed(s);
      try {
        const r = await api<{ rows: JournalRow[]; older: number | null }>(`${base(id)}/journal/items?conv=${conv}&before=${s.copy.older}`);
        if (s.view.conv === conv) {
          beforeShow?.();
          s.copy.older = r.older;
          applyRows(s.copy, r.rows);
          store?.write(id, { epoch: s.copy.epoch, v: s.copy.v, older: r.older }, r.rows, false);
        }
      } catch {
        // the next scroll to the top asks again
      } finally {
        s.loadingOlder = false;
        changed(s);
      }
    },

    // Rows an answer brought (a message taken back, sent now, moved).
    apply,

    // A message for Claude, kept here as sending until the Mac has it (post). Rejects when the Mac turned
    // it down or could not be reached at all and has not said since that it has it; it is then no longer
    // kept here, and the page gives its text back.
    send(id: string, text: string): Promise<void> {
      const m: Message = { id: config.newId(), text, sentAt: Date.now(), state: 'sending', ord: null, item: null };
      apply(id, [{ t: 'message', key: m.id, v: 0, body: m }]);
      return post(id, m).catch((e: unknown) => {
        if (unsent(id, m.id)) throw e;
      });
    },

    // What a signed-out device must not show the next person.
    async forget(): Promise<void> {
      sessions.clear();
      await store?.forget();
    },
  };
}

export type Journals = ReturnType<typeof createJournals>;
