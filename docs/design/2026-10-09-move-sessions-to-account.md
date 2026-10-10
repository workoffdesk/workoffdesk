# Moving open sessions to another Claude account

2026-10-09. Follows [which Claude account runs the sessions](2026-10-08-claude-accounts.md). Picking an account
there changes only the sessions started after it: a session already open keeps running on the account it
started on. When an account's limits run low, the person wants every open session on the new one, without
quitting each Claude and tapping Continue. And the Mac's menu bar app, where the person is when they notice,
cannot pick an account at all.

## The one rule

**A session moves only between turns, and goes on with the same conversation.** It moves when its Claude is idle
and has taken in everything sent to it: nothing waits in its outbox, is being pasted, or is held in Claude's own
queue (a message typed while it worked). One that is working, asking or compacting moves once it is idle again. Moving quits its Claude and starts Claude again in the same pane on the account in use, resuming the
same conversation, exactly as Continue does. A message sent while it moves waits and goes in once Claude has
started. Nothing in a turn is cut off, and no message is lost or typed into the shell between the two Claudes.

## What moves

A session is **on another account** when it is a Claude session here whose Claude runs (status not `ended`),
which was not started from a terminal, whose folder is still there, and whose account (`SessionMeta.claudeDir`,
unknown counting as another) is not the one in use.

- **Started from a terminal** (taken over from one, or opened by `workoffdesk claude`): it runs with that
  terminal's environment and so its account, and the pick does not apply to it (the rule of the accounts
  design). It is not moved. `SessionMeta.terminal` says so, set when a Claude is started with a terminal's
  environment and cleared when it is started without one. Sessions started before this was kept count as
  started here.
- **Ended** (its Claude quit): nothing to move; Continue already starts it on the account in use.
- **Folder gone** (removed while its Claude ran): its Claude could not start again there, so it is neither counted
  nor moved, and keeps running on its account.
- **Never picked**: until an account is picked there is no account in use to move to, and a move is refused.

## The server

`sessions/machine/moves.ts`, a part of `LocalMachine` like the others:

- **Asking for a move** (`moveToAccountInUse`): every session on another account gets `SessionMeta.moving =
  true`, kept in the store so a restart of the server does not forget it. Each one idle now moves at once.
- **When it moves**: whenever a session's status becomes `idle` (the place the outbox is flushed), one marked
  `moving` that has taken in all it was sent moves, and stays marked, so counted as moving, until it has moved or failed to. One no longer on another
  account by then (its account picked back, or gone on with after its Claude quit, which Continue starts on the
  account in use) is unmarked without moving. One whose Claude quits keeps its mark until then; it is not
  counted meanwhile.
- **Moving one** (`Lifecycle.moveClaude`), as one resume of its conversation, so the listing does not take the
  moment between the two Claudes for Claude having quit:
  1. Its status becomes `starting`, which the outbox holds for.
  2. Its Claude (the pane process's child) is sent SIGTERM, as a Claude in a terminal is when it is taken over,
     and waited for, for at most 5 s, until the pane's wrapper no longer runs it.
  3. The pane is started again as Continue starts it (`restartClaude`): Claude resuming the conversation on the
     account in use, `claudeDir` kept.
  4. `moving` is cleared, as it is when any step fails. Claude's SessionStart hook then says it is idle, and what
     waited goes in.
  If its Claude does not quit in time, the status is read again from the screen and the failure is logged: the
  session stays on its account and is counted as on another one. If the start fails, the session has ended,
  as when Continue fails, and Continue starts it on the account in use. Whether the shell its Claude left is
  busy is asked only when going on with a Claude that quit by itself: a Claude moved leaves a shell nothing
  was typed into.
- **SessionEnd** while it moves is not taken for Claude having quit (`claudeMayHaveQuit` looks past a
  conversation being resumed, as the listing already does).

`AccountsView` gains `elsewhere` (sessions on another account, not marked) and `moving` (marked, waiting for
their turn to end).

### Routes and the control socket

- `POST /api/claude/account/move`: marks and moves as above; 409 `account-none-picked` before any pick. Answers
  the view. Logged like a pick.
- The control socket (`sessions/control.ts`, the CLI's way in, owner-only) gains `GET /accounts`,
  `PUT /account { id }` and `POST /account/move`, calling the same methods, beside `POST /sessions`.

## The CLI

`workoffdesk account`:

- no arguments: the accounts, one a line: a check on the one in use, the email, the folder, and what the This
  Mac page says of it (its usage, or why it cannot be picked); then how many sessions are on another account
  and how many will move after their turn.
- `--json`: the view as the server gives it, for the menu bar app.
- `use <email or folder>`: picks it; `--move` also moves the open sessions. An email two accounts share is
  refused, naming their folders.
- `move`: moves the open sessions to the account in use.
- Not running: the service's not-running message, exit 1. Its help line goes in `cli.help`.

## The menu bar app

With two accounts or more, and the service running, the menu has a **Claude Account** section after Restart and
Stop:

- a row per account: the email, a check on the one in use; one that cannot be picked is dimmed with the reason
  under it. A click picks it (`workoffdesk account use <id>`).
- below, when sessions are on another account: **Move N Open Sessions to It** (`workoffdesk account move`);
  while some wait for their turn: *N will move when their reply is done*.

It reads the accounts with `workoffdesk account --json` each time it reads the status, and again after a pick
or a move. The words are in the app's `Words`, English and Chinese.

## The phone and the web

On the This Mac page, under the accounts and their note:

- when sessions are on another account and none waits: a button, **Move N open sessions to this account**;
- while some wait: *N sessions move once their reply is done*, the page asking again every 3 s until none do.

`createMacPage` gains `move()`; the page's words go in `libs/i18n` `settings`. Nothing changes in the iPhone
app's native config, so its runtime stays the same.

## Tests

- Server, with the fake claude of `tests/helpers/machine.ts` (which writes down each start's
  `CLAUDE_CONFIG_DIR`): an idle session moves at once and its Claude is started again resuming the same
  conversation on the picked account; a working one moves only after it is idle; a message sent while it moves
  goes in after, not into the shell; one asking waits; one ended, one started from a terminal and one already on
  the account are left alone; a move before any pick is refused; a Claude that will not quit leaves the session
  as it was; `moving` outlives a restart of the server; the session is never `ended` in between.
- The route and the control socket: the view's counts, the 409.
- The CLI: matching by email or folder, the shared-email refusal, `--json`.
- Client: `move()` and the polling while some wait.
- Menu bar: decoding the view; the section's rows from a view.

## Not in this

- Moving a session started from a terminal (its environment is the terminal's, which the server does not keep).
- Moving by itself when limits run low.
