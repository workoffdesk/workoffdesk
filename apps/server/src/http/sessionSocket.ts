import type { WebSocket } from 'ws';
import type { Sync } from '../journal/index.js';
import type { Machine } from '../sessions/machine.js';

export type VisibilityHook = (sessionId: string, connId: string, visible: boolean) => void;
// The session's journal (journal/index.ts): what a copy above a version is missing, and each change as written.
export type JournalSource = {
  ingest: (sessionId: string) => Promise<void>;
  sync: (sessionId: string, epoch: string | undefined, v: number) => Sync;
  onRows: (sessionId: string, cb: (from: number, change: Sync) => void) => () => void;
};

// How often the screen is read while the page is looked at; what changed on it is sent at once.
const SCREEN_MS = 250;
// Said at least this often while the page is looked at, so the page can tell a quiet line from a dead one.
const ALIVE_MS = 4000;
// How often the whole screen is read while it is watched as text; it is long, so less often than the chat's
// part, and sooner after a key.
const SCREEN_TEXT_MS = 1000;
const KEY_SHOWS_MS = 300;

let connSeq = 0;

// A phone's line to one session: what is typed goes to the program, the page says whether it is being
// looked at, and the line closes when the session ends. While the page is looked at, it tells the page what
// the screen holds for the chat each time that changes ({type:'screen'}), so the page need not keep asking.
// Asked ({type:'screen'}), it sends what the screen holds even if it sent it already; while the screen is watched as text ({type:'screenText', on}), it sends the text, with
// its history, each time that changes. A page that says where its copy of the journal is
// ({type:'journal', epoch, v}) is sent what it is missing, then each change ({type:'journal', from, v, rows}).
export async function serveSession(
  socket: WebSocket,
  id: string,
  machine: Machine,
  onVisibility?: VisibilityHook,
  journal?: JournalSource,
): Promise<void> {
  const connId = String(++connSeq);
  // Listeners go on before the first await so nothing the client sends early is lost.
  const early: [Buffer, boolean][] = [];
  let handle: ((data: Buffer, isBinary: boolean) => void) | null = null;
  let closed = false;
  let cleanup = () => {};
  socket.on('message', (data: Buffer, isBinary: boolean) => (handle ? handle(data, isBinary) : early.push([data, isBinary])));
  const ended = () => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'exit' }));
  };
  // Watched before it is first looked for, so a session that ends while it is being found is not missed.
  const unwatch = machine.onChange(async () => {
    if (closed || (await machine.exists(id).catch(() => true))) return;
    ended();
    socket.close(1000);
  });
  socket.on('close', () => {
    closed = true;
    onVisibility?.(id, connId, false);
    unwatch();
    cleanup();
  });

  if (!(await machine.exists(id))) {
    ended();
    socket.close(4404, 'no such session');
    return;
  }
  if (closed) return;
  await machine.fitForChat(id).catch(() => {});
  if (closed) return;

  let lastSent = 0;
  const send = (msg: object) => {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(msg));
    lastSent = Date.now();
  };
  const ping = setInterval(() => socket.ping(), 25_000);
  // Where the page's copy of the journal is, once it has said and been caught up; a page behind a change
  // is sent nothing until it says where it is again.
  let journalAt: number | null = null;
  const unwatchJournal =
    journal?.onRows(id, (from, change) => {
      if (journalAt === null) return;
      const at = journalAt;
      if (change.reset) send({ type: 'journal', from: at, ...change });
      else if (at >= from && at < change.v) send({ type: 'journal', from: at, v: change.v, rows: change.rows.filter((r) => r.v > at) });
      else return;
      journalAt = change.v;
    }) ?? (() => {});
  const catchUp = async (epoch: string | undefined, v: number) => {
    if (!journal) return;
    journalAt = null;
    await journal.ingest(id).catch(() => {});
    if (closed) return;
    const sync = journal.sync(id, epoch, v);
    send({ type: 'journal', from: v, ...sync });
    journalAt = sync.v;
  };

  // One reading at a time, only while the page is looked at.
  let visible = false;
  let reading = false;
  let lastScreen = '';
  let screenTimer: NodeJS.Timeout | undefined;
  const readScreen = async () => {
    if (closed || !visible || reading) return;
    reading = true;
    try {
      const screen = await machine.onScreen(id);
      const now = JSON.stringify(screen);
      if (now !== lastScreen) {
        lastScreen = now;
        send({ type: 'screen', screen });
      } else if (Date.now() - lastSent >= ALIVE_MS) send({ type: 'alive' });
    } catch {
      // the next reading tries again
    } finally {
      reading = false;
    }
    if (!closed && visible) screenTimer = setTimeout(readScreen, SCREEN_MS);
  };

  // The same for the screen as text, while it is watched.
  let textOn = false;
  let readingText = false;
  let textAgain = false;
  let lastText: string | null = null;
  let textTimer: NodeJS.Timeout | undefined;
  const readText = async () => {
    clearTimeout(textTimer);
    if (closed || !textOn) return;
    if (readingText) {
      textAgain = true;
      return;
    }
    readingText = true;
    textAgain = false;
    try {
      const text = await machine.screenText(id);
      if (text !== lastText && textOn) {
        lastText = text;
        send({ type: 'screenText', text });
      }
    } catch {
      // the next reading tries again
    } finally {
      readingText = false;
    }
    if (!closed && textOn) textTimer = setTimeout(readText, textAgain ? 0 : SCREEN_TEXT_MS);
  };
  const textSoon = () => {
    if (!textOn) return;
    clearTimeout(textTimer);
    textTimer = setTimeout(readText, KEY_SHOWS_MS);
  };

  cleanup = () => {
    clearInterval(ping);
    clearTimeout(screenTimer);
    clearTimeout(textTimer);
    unwatchJournal();
  };

  let input = Promise.resolve();
  handle = (data, isBinary) => {
    if (isBinary) {
      const text = data.toString('utf8');
      input = input.then(() => (closed ? undefined : machine.type(id, text).then(textSoon, () => {})));
      return;
    }
    let msg: { type?: unknown; visible?: unknown; on?: unknown; epoch?: unknown; v?: unknown } | null;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    if (msg?.type === 'journal' && Number.isSafeInteger(msg.v) && (msg.v as number) >= 0) {
      void catchUp(typeof msg.epoch === 'string' ? msg.epoch : undefined, msg.v as number);
      return;
    }
    if (msg?.type === 'screen') {
      lastScreen = '';
      void readScreen();
      return;
    }
    if (msg?.type === 'screenText') {
      textOn = !!msg.on;
      lastText = null;
      void readText();
      return;
    }
    if (msg?.type === 'visible') {
      onVisibility?.(id, connId, !!msg.visible);
      visible = !!msg.visible;
      clearTimeout(screenTimer);
      // What the page had may be stale after it was away: the next reading is sent whatever it holds.
      lastScreen = '';
      if (visible) void readScreen();
    }
  };
  for (const [d, b] of early.splice(0)) handle(d, b);
}
