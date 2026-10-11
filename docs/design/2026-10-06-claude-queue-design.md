# The queue is Claude's own

Status: shipped in 2.18.8 (2026-10-06) and corrected in 2.18.9. Supersedes the queue part
of `2026-10-06-session-journal-design.md`: until 2.18.7 the Mac held every message sent while Claude worked
until the turn was over.

## What was asked

Queueing belongs to Claude: workoffdesk should not keep a queue of its own, and a message Claude still has
queued should show as queued in the chat, judged by Claude's own record of that message.

So a message goes to Claude the moment it is sent, the way typing it into the terminal would, and the queue
tray shows what Claude itself still holds. workoffdesk keeps no queue of its own unless Claude cannot be typed to.

**Invariant:** the queue tray shows exactly the messages Claude has not read yet, in the order it will read
them, and says of each where it waits.

## What Claude Code does (2.1.291, measured on one Mac)

Text typed while Claude works goes into Claude Code's own queue, and the transcript records what becomes of
it as `queue-operation` lines:

| Line | Meaning | Count in all local transcripts |
|---|---|---|
| `enqueue` (with `content`) | typed while Claude was busy | 16,820 |
| `remove`, `reason: absorbed_mid_turn` | read at Claude's next step, inside the turn | 7,589 |
| `dequeue` | started a turn of its own | 7,420 |
| `remove` (no reason) | taken out by its words | 1,660 |
| `popAll` | pulled back into the prompt to be changed | 57 |

- A queued message is read at the next step, not at the end of the turn: median **12 s** from `enqueue` to
  `absorbed_mid_turn`. The transcript then has it as a `queued_command` attachment where Claude read it.
- There is no "send now" in Claude Code: everything queued is read at the next step. Esc interrupts Claude.
- Changing a queued message is `popAll`: all of them go back into the prompt as one text. One message cannot be
  changed, dropped or moved on its own.
- Things Claude cannot queue: while a dialog is open (a permission, a choice, `/model`), typed text and Enter go
  to the dialog. Before Claude has started, nothing takes the text. After it ended, the shell would run it.

One user's own use backs the change: 117 of 257 sends were followed by Send now, mostly within seconds.

## Design

### Mac

- **Delivery** (`outbox.ts`): `HOLDS` is `starting`, `waiting`, `compacting` and `ended`. `working` is no
  longer in it, so a message sent while Claude works is pasted at once. The paste still checks for an open
  dialog first (`Machine.dialogOpen`), and if one is open the message waits on the Mac.
- **Where a pasted message goes is decided as it is pasted** (`Outbox.paste`): a message pasted while Claude
  works is `enqueued` from the start, because Claude Code queues what is typed while it works; otherwise it is
  `delivering` and then `delivered`. Deciding there means no device ever sees the message somewhere else on
  the way. 2.18.8 had the devices guess from the status, so a message sent at an idle prompt went chat → tray
  → chat for the moment between the paste and its prompt landing.
- **Following Claude's queue** (`journal/ingest.ts`, `agents/claude/turn.ts`): when lines read from the
  transcript include a `queue-operation`, the Mac works out what Claude holds now, using `heldByClaude` over
  the transcript's end. That now returns the words, not a count, and handles `popAll`. A `delivering` or
  `delivered` message whose words Claude holds (oldest first, word for word as pasted) becomes `enqueued`;
  this covers a status that had not yet caught up with Claude being at work. A message never goes back from
  `enqueued`: it lands through the `queued_command` item that follows, is `taken` when a `popAll` after it was
  sent pulls its words back into the prompt (and they are not held again), or becomes `unconfirmed` at the end of
  the turn. Going back would race the paste, since the transcript can be read between the paste and Claude
  writing `enqueue`.
- **Message states:** `queued` (held by the Mac), `delivering`, `delivered`, **`enqueued`** (in Claude's
  queue), `landed`, `taken`, `unconfirmed`. An `enqueued` message counts as on its way:
  - landing looks for it;
  - when the turn is truly over (the Stop hook is held back while Claude still holds messages), one never read
    becomes `unconfirmed`, so nothing hangs in the tray for good;
  - on start, the Mac lands what the transcript already has.

### iPhone and web (`libs/client/src/journal.ts`)

Each message Claude has not read waits in one of three places (`Waits`):

| Where | Which messages | Row shows |
|---|---|---|
| `claude` | `enqueued`, as the Mac says | "In Claude's queue" |
| `mac` | `queued` | Edit, Send now, ↑↓, Delete |
| `sending` | not yet answered by the Mac, when it will be queued (Claude works, or the Mac holds others) | "Sending…" |

- The tray lists `claude` rows first, then `mac` rows in their order, then `sending` rows: the order Claude
  will read them.
- ↑↓ move a message only among the `mac` rows.
- The header says "Claude reads these after the step it is on" while Claude works.
- A message in the tray is never also drawn as a bubble. One sent at an idle prompt is a bubble below the live
  text until it lands (2.18.6).

## Cases

| Case | What happens |
|---|---|
| Sent while Claude works | Pasted, then "In Claude's queue" within the next transcript read; it moves into the chat where Claude read it, ~12 s later |
| Sent while a dialog is open | Held on the Mac (`waiting`), editable; pasted when the dialog closes and Claude works again |
| A dialog opened mid-turn without a status change (`/effort`) | The paste finds the dialog and the message waits on the Mac; it is tried again at the next look |
| Sent before Claude started, while compacting, after it ended | Held on the Mac, as before |
| Pulled back into the prompt at the Mac (`popAll`) | `taken` as soon as the transcript says so, and drawn nowhere: it is the person's at the Mac to change, send or drop; what they send shows as a prompt typed there |
| Pictures | workoffdesk sends them as quoted paths, and Claude's queue records them as they are (checked), so they match |
| The Mac restarts with messages enqueued | On start the Mac lands what the transcript has; the rest stay enqueued until the turn ends |
| Older apps (before 2.18.8) | See `enqueued` as an unknown state and draw nothing for it until they update, which the next start does |

## Not done

- A message typed into Claude's queue at the Mac's own terminal is not shown in the tray: only messages sent
  through workoffdesk have rows. The tray could show Claude's whole queue from `heldByClaude`'s words if wanted.
- Taking a message back out of Claude's queue from the phone (it would be `popAll` and retyping the rest). With
  a 12 s median there is little time to want it.
- Send now stays only for rows the Mac holds. While a dialog is open the Mac refuses it (409), as before.

## Checked

- typecheck and lint for every package, with the two old warnings.
- Live after the deploy: a message sent under 2.18.7 was held, then pasted by 2.18.8 three minutes later. The transcript has `enqueue`, then `remove absorbed_mid_turn` 0.4 s later, and the
  server log has `message landed … "was":"enqueued"`.
- 2.18.9 on the simulator: the QA stand-in now writes `enqueue` and `remove absorbed_mid_turn`.
  - A send at an idle prompt was a bubble that landed in the chat and never showed in the tray.
  - A send during a turn showed "1 queued · Claude reads these after the step it is on · In Claude's queue" and then landed
    where Claude read it.
  - The first look ran an old bundle, because the app had not reloaded from the restarted Metro; it was redone
    after terminating the app.
