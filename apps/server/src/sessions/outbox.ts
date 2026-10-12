import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { DomainError } from '../system/errors.js';
import type { MessageRow, MessageState } from '../journal/index.js';
import type { ClaudeStatus } from './machine.js';

// A message sent while Claude could not take it, waiting in the order it was sent.
export type Queued = { id: string; text: string; at: number };

// Where the messages are kept: the journal's message rows (journal/index.ts).
export type MessageStore = {
  messages(id: string): MessageRow[];
  putMessage(id: string, m: MessageRow): void;
};

// What is sent while Claude works goes to it at once, into its own queue, which it reads at its next step
// (journal/ingest.ts follows it there). What is sent while Claude starts or asks something waits here, to be
// looked over, changed or sent at once: a dialog would take what is typed. Claude takes nothing while it
// compacts, and an ended session is a shell that would run what it is sent.
const HOLDS = new Set<ClaudeStatus | null>(['starting', 'waiting', 'compacting', 'ended']);
// Apart, so Claude takes each message on its own rather than as one paste.
const GAP_MS = 400;

const queued = (m: MessageRow): Queued => ({ id: m.id, text: m.text, at: m.sentAt });

// Where the messages were kept before the journal: read into it once, then set aside as <file>.migrated.
export function migrateQueueFile(file: string, store: MessageStore): void {
  if (!existsSync(file)) return;
  const f = JSON.parse(readFileSync(file, 'utf8')) as { sessions?: Record<string, Queued[]>; sent?: Record<string, Queued[]>; done?: Record<string, string[]> };
  const put = (id: string, m: MessageRow) => store.messages(id).some((r) => r.id === m.id) || store.putMessage(id, m);
  const row = (q: Queued, state: MessageState, ord: number | null): MessageRow => ({ id: q.id, text: q.text, sentAt: q.at, state, ord, item: null });
  for (const [id, list] of Object.entries(f.done ?? {})) for (const qid of list) put(id, { id: qid, text: '', sentAt: 0, state: 'landed', ord: null, item: null });
  for (const [id, list] of Object.entries(f.sent ?? {})) for (const q of list) put(id, row(q, 'delivered', null));
  for (const [id, list] of Object.entries(f.sessions ?? {})) list.forEach((q, n) => put(id, row(q, 'queued', n + 1)));
  renameSync(file, `${file}.migrated`);
}

// A delivery that was asked for but not answered (a tmux that timed out) may have gone in: typing it again
// could put it there twice.
const mayHaveRun = (e: unknown) => (e as { mayHaveRun?: unknown } | null)?.mayHaveRun === true;

// What is sent to a Claude session reaches it in the order it was sent; what it cannot take yet waits, in
// the journal, through a restart, until it can. Each message is one row whose state says where it is:
// queued, delivering (being pasted), delivered, landed (the transcript has it), taken back, unconfirmed.
export class Outbox {
  private readonly store: MessageStore;
  private readonly status: (id: string) => ClaudeStatus | null;
  private readonly deliver: (id: string, text: string, qid: string) => Promise<void>;
  private readonly changed: () => void;
  private readonly failed: (id: string, e: unknown) => void;
  private readonly held: (id: string, qid: string, why: unknown) => void;
  private readonly gapMs: number;
  private readonly running = new Map<string, Promise<void>>();
  private readonly again = new Set<string>();
  // Messages being pasted from a send, by id, with what a send of the same id answers.
  private readonly pastes = new Map<string, Promise<Queued | null>>();

  constructor(deps: {
    store: MessageStore;
    status: (id: string) => ClaudeStatus | null;
    // qid: the id the message was sent under, for an agent that hands it back on what the message made.
    deliver: (id: string, text: string, qid: string) => Promise<void>;
    changed: () => void;
    // A message that could not go, and why; it waits for the next try, unless it may have gone in.
    failed?: (id: string, e: unknown) => void;
    // A message kept back rather than typed in, and why: what Claude is doing, others waiting before it, or
    // what stopped its paste.
    held?: (id: string, qid: string, why: unknown) => void;
    gapMs?: number;
  }) {
    this.store = deps.store;
    this.status = deps.status;
    this.deliver = deps.deliver;
    this.changed = deps.changed;
    this.failed = deps.failed ?? (() => {});
    this.held = deps.held ?? (() => {});
    this.gapMs = deps.gapMs ?? GAP_MS;
  }

  list(id: string): Queued[] {
    return this.waiting(id).map(queued);
  }

  // Null when the message went to Claude at once; otherwise it waits, behind any already waiting. One that
  // failed to go waits for the next flush rather than being tried again at once. One sent again under the
  // id it was given (`qid`) is taken once: what it got the first time comes back.
  async send(id: string, text: string, qid = randomBytes(6).toString('hex')): Promise<Queued | null> {
    const pasting = this.pastes.get(qid);
    if (pasting) return pasting;
    const known = this.store.messages(id).find((m) => m.id === qid);
    if (known?.state === 'queued') return queued(known);
    if (known && known.state !== 'taken') return null;
    const m: MessageRow = { id: qid, text, sentAt: Date.now(), state: 'queued', ord: null, item: null };
    const status = this.status(id);
    if (!this.waiting(id).length && !HOLDS.has(status)) {
      return this.pasting(qid, async () => ((await this.paste(id, m)) ? null : (this.put(id, { ...m, ord: this.lastOrd(id) + 1 }), queued(m))));
    }
    this.held(id, qid, HOLDS.has(status) ? status : 'behind');
    this.put(id, { ...m, ord: this.lastOrd(id) + 1 });
    void this.flush(id);
    return queued(m);
  }

  // One run per session at a time; asked again while running, it looks once more before it ends.
  flush(id: string): Promise<void> {
    const run = this.running.get(id);
    if (run) {
      this.again.add(id);
      return run;
    }
    // Started after it is registered, so a send made while delivering finds it running; it is unregistered
    // in the same step that finds nothing more asked of it, so no flush falls between the two.
    const next = Promise.resolve().then(async () => {
      try {
        do {
          this.again.delete(id);
          await this.deliverHeld(id);
        } while (this.again.has(id));
      } finally {
        this.running.delete(id);
      }
    });
    this.running.set(id, next);
    return next;
  }

  // The text of a message taken back before it went, or null when it is no longer waiting.
  remove(id: string, qid: string): string | null {
    const m = this.waiting(id).find((w) => w.id === qid);
    if (!m) return null;
    this.put(id, { ...m, state: 'taken', ord: null });
    return m.text;
  }

  // Goes to Claude now, whatever it is doing, out of its turn; false when it is not waiting any more. One
  // that could not go waits again, first, and the caller is told it did not go.
  async sendNow(id: string, qid: string): Promise<boolean> {
    const m = this.waiting(id).find((w) => w.id === qid);
    if (!m) return false;
    const answer = await this.pasting(qid, async () => {
      if (await this.paste(id, m)) return null;
      this.put(id, { ...m, state: 'queued', ord: this.firstOrd(id) - 1 });
      return queued(m);
    });
    if (answer) throw new DomainError(503, 'not sent');
    return true;
  }

  // One place earlier (-1) or later (1) among those waiting; false when it is not waiting any more.
  move(id: string, qid: string, by: -1 | 1): boolean {
    const list = this.waiting(id);
    const i = list.findIndex((m) => m.id === qid);
    if (i < 0) return false;
    const j = Math.max(0, Math.min(list.length - 1, i + by));
    if (i === j) return true;
    this.put(id, { ...list[i], ord: list[j].ord });
    this.put(id, { ...list[j], ord: list[i].ord });
    return true;
  }

  private async deliverHeld(id: string): Promise<void> {
    let first = true;
    for (let m = this.waiting(id)[0]; m && !HOLDS.has(this.status(id)); m = this.waiting(id)[0]) {
      if (!first) await new Promise((r) => setTimeout(r, this.gapMs));
      first = false;
      // Taken back or moved during the gap.
      if (this.waiting(id)[0]?.id !== m.id) continue;
      if (!(await this.paste(id, m))) {
        this.put(id, { ...m, state: 'queued' });
        this.again.delete(id);
        return;
      }
    }
  }

  // Pastes the message, recorded as delivering until it is in: true once it is (or may be, after a paste
  // that was asked for and not answered), false when it did not go; then the caller says where it waits.
  // Typed while Claude works, it goes into Claude's own queue, and is said to from the start (enqueued),
  // so no device sees it anywhere else on the way.
  private async paste(id: string, m: MessageRow): Promise<boolean> {
    this.put(id, { ...m, state: this.status(id) === 'working' ? 'enqueued' : 'delivering', ord: null });
    let went = true;
    try {
      await this.deliver(id, m.text, m.id);
    } catch (e) {
      this.failed(id, e);
      went = mayHaveRun(e);
      if (!went) this.held(id, m.id, e);
    }
    // The transcript may have shown it landed before the paste answered.
    if (went && this.store.messages(id).find((r) => r.id === m.id)?.state === 'delivering') this.put(id, { ...m, state: 'delivered', ord: null });
    return went;
  }

  // Known as being delivered from before the paste starts until it is recorded as sent or held again.
  private pasting(qid: string, paste: () => Promise<Queued | null>): Promise<Queued | null> {
    const answer = paste().finally(() => this.pastes.delete(qid));
    this.pastes.set(qid, answer);
    return answer;
  }

  private waiting(id: string): MessageRow[] {
    return this.store
      .messages(id)
      .filter((m) => m.state === 'queued')
      .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
  }

  private lastOrd(id: string): number {
    return this.waiting(id).at(-1)?.ord ?? 0;
  }

  private firstOrd(id: string): number {
    return this.waiting(id)[0]?.ord ?? 0;
  }

  private put(id: string, m: MessageRow): void {
    this.store.putMessage(id, m);
    this.changed();
  }
}
