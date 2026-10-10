# One journal per session, and the phone draws from its own copy: design

2026-10-06. Drawn from one ordered record, kept in SQLite, the chat would not have these problems. The chat page of the
iPhone app (and of the web app) is put together from four sources that each arrive on their own clock,
and the phone guesses how they fit. This replaces the guessing with one ordered record the Mac writes and
the phone copies.

Decided 10-06: the "Claude is writing…" preview stays, deduplicated on the Mac. Approach A below was
picked as recommended; this file is the record.

## The problem, as a class

What the chat page of a session shows today, and where each part comes from:

| Part | Source | Clock |
|---|---|---|
| Turns of the conversation | `GET …/chat?from=<byte>&sid=` and the session socket's `{type:'chat', at, read}`, read from the transcript by byte offset | each read |
| Messages waiting, sent, done with | `/api/events` list: `queued`, `sent`, `done` of every session | each list snapshot |
| Status (working, waiting, idle …) | the same list | each list snapshot |
| Questions, dialogs, mode, suggestion, the live text | `GET …/choices` and the socket's `{type:'screen'}`, read off tmux | every 250 ms while looked at |
| Messages on their way, taken back | the page's own React state (`onItsWay`, `taken`) | this screen |
| Tasks, background commands | worked out on the phone from the turns it happens to have read | each render |

The phone then guesses: which queued message became which turn (`sent.ts`, `useJustSent`, by text and
time), whether the live text is already a turn (`written()`, which only looks back to the last message),
whether an answer to a send is older than the list it arrived after (`asOf` against `q.at`), which
background commands still run (from whatever page of turns it read). Each guess is right on the path that
was reported and wrong on the next one. Reports of this class: a message shown both sent and "Sending…"
or queued (four reports), one both in the chat and in the queue tray, messages out of order, live text
shown twice or a reply shown then taken away (two), background commands that had ended, a wrong status or
an empty chat after a restart (two). Eleven fixes so far, each for one path.

## Invariant

**What a session's page shows is drawn only from the device's copy of that session's journal, and that
copy changes only by applying the Mac's rows in the Mac's order.** Every fact has one row under one id:
a message the phone sent is one row from the moment it is typed until it is a turn of the conversation,
so it cannot be in two places; what the Mac records together (a reply landing and its live preview
clearing) arrives together.

## Who already knows

- **Claude Code knows each turn's identity.** Every transcript line that becomes a turn carries a
  `uuid`; in this session's 1,083 such lines none repeats (checked 10-06 15:1x). Items are named by it, not by
  byte offsets or array positions.
- **The transcript has prompts verbatim.** 1,085 prompts typed by a person in this week's transcripts:
  none collapsed to `[Pasted text …]`, the longest stored whole, only surrounding whitespace differs; a
  message with pictures is stored exactly as the phone sent it (`"path" words`). So the Mac can tell
  which of the messages it pasted a new prompt is, at the moment the transcript gets it.
- **The Mac is the only party that sees everything at once**: the paste, the transcript line it
  became, the screen, the hooks. Matching belongs there. The phone sees each through a slow line, late
  and out of order.
- **SQLite already enforces "one row per id"**: `PRIMARY KEY` and `ON CONFLICT`, on the Mac
  (`node:sqlite`, built into Node 24.14, checked: works without a flag, SQLite 3.51.2, one
  ExperimentalWarning at start) and on the phone (`expo-sqlite`, already in the app binary, so no new
  build or review: everything ships over the air).

## Design

### The journal (Mac)

`apps/server/src/journal/` keeps `~/.workoffdesk/journal.db` (WAL). Each workoffdesk session has a counter `v`
that only goes up; every change to anything the page shows is an upsert of one row with the next `v`.
It is an event log in which each id keeps only its latest version, so it does not grow with the screen's
changes, and a copy catches up by asking for rows with `v` above its own.

```sql
CREATE TABLE journal (            -- one row per database: a new file is a new epoch
  epoch TEXT NOT NULL
);
CREATE TABLE session (
  id TEXT PRIMARY KEY,            -- workoffdesk's session id (tmux)
  v INTEGER NOT NULL,             -- last version handed out
  conv TEXT,                      -- the Claude conversation shown now (claudeSessionId; /clear starts another)
  conv_read INTEGER NOT NULL DEFAULT 0  -- bytes of conv's transcript taken in
);
CREATE TABLE item (               -- a turn of a conversation, from the transcript; never changes once written
  session TEXT NOT NULL,
  id TEXT NOT NULL,               -- `${line uuid}:${n}`, n = its place among the line's items
  conv TEXT NOT NULL,
  pos INTEGER NOT NULL,           -- order in the transcript
  v INTEGER NOT NULL,
  body TEXT NOT NULL,             -- ChatItem as JSON, as today
  PRIMARY KEY (session, id)
);
CREATE INDEX item_by_pos ON item (session, conv, pos);
CREATE INDEX item_by_v ON item (session, v);
CREATE TABLE message (            -- what the phone or the web sent through workoffdesk
  session TEXT NOT NULL,
  id TEXT NOT NULL,               -- the qid the sender made
  v INTEGER NOT NULL,
  text TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  state TEXT NOT NULL,            -- queued | delivering | delivered | landed | taken | unconfirmed
                                  -- (a device adds sending and failed for its own, before the Mac has them)
  ord REAL,                       -- place among the queued
  item TEXT,                      -- the item it became, once landed
  PRIMARY KEY (session, id)
);
CREATE INDEX message_by_v ON message (session, v);
CREATE TABLE state (              -- what only has a current value
  session TEXT NOT NULL,
  name TEXT NOT NULL,             -- status | screen | live | asks | tasks | background | conv
  v INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (session, name)
);
CREATE INDEX state_by_v ON state (session, v);
```

**`message` is the outbox.** `Outbox` keeps its rules (hold while Claude cannot take it, one at a time,
400 ms apart, idempotent by qid) and stores in this table instead of `queue.json`, which is read once into
it and kept as `queue.json.migrated`. The list's `queued`, `sent`, `done` for old app versions are read
from it. No second copy of the queue exists.

**What writes rows, each in one place:**

| Row | Written by | When |
|---|---|---|
| `item` | `journal/ingest.ts`: `chatItems` of each new whole line of the conversation's transcript | on a change of the file (one `fs.watch` per Claude session the Machine knows), on every hook, and before answering any sync (so an answer is never behind the file) |
| `message` | `Outbox` | queued, delivering, delivered, taken back, moved, sent now; landed by ingest (below) |
| `state.status` | `Machine.setStatus` | the one place status changes today |
| `state.screen`, `state.live` | the screen watcher (`journal/screen.ts`), one per session while any client looks at it, replacing the per-socket loop in `session-ws.ts` | when what it reads changes |
| `state.asks` | the asks holder (`agents/claude/asks.ts`) | when an ask comes or ends |
| `state.tasks`, `state.background` | ingest, from the whole conversation, not a page of it | when an item changes them |
| `state.conv` | ingest | when the session's conversation changes (/clear, resume) |

Each write takes the next `v` and is one transaction with whatever must arrive with it.

**A message landing.** When ingest takes in a prompt typed by a person (a `user` item from a `human`
record, or the `queued_command` attachment Claude Code writes for one taken mid-turn), it looks for the
oldest message of that session in `delivering` or `delivered` whose trimmed text equals the prompt's, and
in the same transaction sets it `landed` with `item` = the item's id. No match: someone typed it at the
Mac, and it is only an item. Two messages with the same words land in the order they were pasted.
A message still `delivered` when the session next goes idle is `unconfirmed`: shown once, where it was sent, and logged (`message not found in the transcript`) so a
case of Claude Code changing what it was given is seen rather than guessed at.

**Live text.** The screen watcher reads the reply being written; the journal stores it in `state.live`
only while no `text` item since the last prompt of the current turn contains its first 40 characters
(the test `written()` does on the phone today, on the Mac's whole turn instead of the phone's page of
it). Ingest re-checks it in the same transaction that writes a `text` item, so the reply and the end of
its preview are one change.

**Epoch.** `journal.epoch` is made with the file. A copy from another epoch (the file was deleted or
rebuilt) starts over; because ids come from the transcript and the senders, starting over upserts the
same rows and duplicates nothing.

### Sync

- `GET /api/m/:machine/sessions/:id/journal?epoch=&v=` → `{ epoch, v, rows, more }`. `rows` are
  `{ t: 'item' | 'message' | 'state', key, v, body }` with `v` above the asked one, oldest first, at most
  500 (`more` when cut). A copy from another epoch, or `v` 0, gets every `message` and `state` row and
  the newest 100 items of the current conversation, with `reset: true`; items older than those come by
  page and are not part of `v`.
- `GET /api/m/:machine/sessions/:id/journal/items?conv=&before=<pos>` → the 100 items before `pos`.
  Items never change, so pages and `v` never interfere.
- The session socket says, after the client says where its copy is (`{type:'journal', epoch, v}`),
  `{type:'journal', from, v, rows}` for each change. The client applies it only when `from` is its own
  `v`; otherwise it asks with the GET. The socket is the fast path; the GET is the one that is always
  right. Both go through the same `apply`.
- Sending is the same `POST …/messages` with the client's qid. Its answer carries the message's row; the
  client applies it like any row, so an answer that comes after a newer row (a slow line) changes
  nothing: rows apply only when their `v` is above the stored one.

### The copy (device) and the page

`libs/client/src/journal.ts` is the engine, shared by the iPhone app and the web app: `apply`, the
sync loop (socket push, GET when behind, at the poll intervals `pushes.ts` uses today), paging, and a
projection per open session:

```ts
type SessionView = {
  conv: string | null;
  items: ChatItem[];            // the current conversation's, in pos order, each with its id
  older: boolean;               // there are items before the first one held
  messages: Message[];          // every message row: queued, on its way, landed (with its item id)
  status: ClaudeStatus | null;
  screen: OnScreen;             // choices, panel, mode, suggestion
  live: string | null;
  asks: Ask[];
  tasks: Task[];
  background: Background[];
};
```

The store is a port: the iPhone app's is `expo-sqlite` (`apps/mobile/src/journalStore.ts`, the same
tables plus `cursor(session, epoch, v)`, one file per Mac it is signed in to, since session ids and
versions are each Mac's own), the web app's is in memory. `apply` writes the store and the
projection in one step; React reads the projection (`useSyncExternalStore`), never the network.

A message typed on this device is written to the store at once as `state: 'sending'`, `v: 0`, by its
qid; the Mac's row for that qid replaces it. Nothing else holds it. A device that is closed while
sending finds the row on the next start and posts it again under the same qid (taken once).

What the page draws from the view:

- **Turns**: `turns(items)` and `rows()` as today (they are pure functions of the items). A turn that
  is a message from this device's sender carries the "Sent" mark from `message.item`, not from a
  match of text and time.
- **Messages not landed**: `sending` and `delivering`/`delivered` as bubbles at the end; `queued` in
  the queue tray in `ord` order; `taken` not at all; `unconfirmed` as a bubble at its `sent_at`.
- **Live text, status, cards, tasks, background**: from `live`, `status`, `screen`, `asks`, `tasks`,
  `background` as given.

Removed from the clients: `chatFeed.ts` (reads by byte), `sent.ts` and `useJustSent`, `createOnMac`,
the page's `onItsWay` and `taken`, `written()` and `liveText()`, `sessionList.held` / `notHeld`, the
chat half of `pushes.ts`, `chatStore.ts`. What stays: the session list (`/api/events`) for the list
screen (next section), the image and upload routes, the commands, keys and choices routes.

## Not in this design

- **The session list** (status, last words, unread on the list screen) keeps `/api/events`. A session's
  own page no longer reads anything from it, so the two pages can differ for a moment but each is whole.
  Moving the list onto a machine-wide journal is the next design, after this one is in use.
- **History across /clear**: the page shows the current conversation, as today; older conversations
  stay in the journal and could be shown under a divider later.
- **Screen history**: only the current screen is kept.

## Errors and edges

| Case | What happens |
|---|---|
| Line drops mid-sync | the copy keeps its `v`; the next GET or push continues from it |
| Push skipped one | `from` ≠ copy's `v`: GET |
| Answer to a send arrives late | its row's `v` is below the stored one: ignored |
| Send fails for good (4xx) | the `sending` row becomes `failed` on the device: tap to send again (same qid) or take back to the composer |
| Mac restarts | `journal.db` survives; `delivering` rows read back as `delivered` (it may have gone in); live and screen are read again |
| `journal.db` lost or unreadable | moved aside (`journal.db.broken-<time>`), a new one made; ingest rebuilds the items from the transcripts under the same ids; messages that were waiting in it are lost, and the log says so; new epoch, copies start over without duplicates |
| Device copy unreadable | dropped; synced from `v` 0 |
| /clear | `state.conv` changes; the page shows the new conversation; messages already landed stay with the old one |
| Two devices | both copy the same rows; each holds its own `sending` rows until the Mac has them |
| Session ended | `state.status` is `ended`; the device keeps its copy, so an ended session still opens |
| Old app versions | the old routes stay, reading the queue from `message`; removed once the server's update log shows no running update older than the journal release for a week |

## Order, each its own release

1. **Journal on the Mac, inert.** `journal.db`, ingest of items, status, screen, live, asks, tasks,
   background; message landing worked out but only logged (`message landed`, `message not found in the
   transcript`); the sync routes. No client uses them. Checked on real data: every transcript under
   `~/.claude/projects` ingested gives the same items as `readChat` gives today, and every message sent
   from the phone in the days after lands.
2. **The outbox moves into the journal.** `queue.json` migrated; the list's `queued`/`sent`/`done` read
   from `message`.
3. **The engine and the web app.** `libs/client/src/journal.ts` with the in-memory store; the web
   app's session page draws from it (it ships with the server, so it is first to be looked at).
4. **The iPhone app.** `journalStore.ts` on `expo-sqlite`; the session page draws from the view; the
   removed code goes. Checked on the simulator against a real Mac, then on a phone.
5. **Old routes removed**, when the update log shows no older app for a week.

## Verification

This change was checked with typecheck, lint and running it, and in addition:

- **Replay** (step 1): a script ingests every transcript into a scratch journal and compares the items
  with `readChat` from 0, item for item; any difference is explained or fixed before step 2.
- **Landing** (steps 1–2): the server log has `message landed` for each message sent from the phone,
  and `message not found in the transcript` is investigated each time it appears.
- **The cases above** on the simulator (step 4): send while working, send now, take back, a dropped
  line (the bad-network server used for pictures), a Mac restart mid-send, /clear, app killed while
  sending; each must show every message once, where it belongs.
