# Run in background, and background agents in the list

## What is wrong

- While Claude runs a command in the foreground (a wait for a build, a health loop), messages sent to it stay
  in Claude Code's own queue until the command ends. At the Mac one presses ctrl+b to send the command to the
  background and Claude reads the queue at once; the phone and the web page have no way to do that.
- The bar of what runs in the background lists commands only. An agent Claude starts in the background is a
  line in the chat and nothing more, so which of them still run cannot be told without scrolling.

## Invariants

1. The Run in background button shows exactly while Claude Code itself offers to send what runs in the
   foreground to the background, and pressing it sends that and nothing else: no key goes to the session when
   the offer is no longer on screen.
2. The background bar lists every command and agent Claude has started in the background and not yet heard
   the end of.

## Who knows

- Claude Code draws the offer under the running tool: `(ctrl+b to run in background)`, or
  `(ctrl+b ctrl+b (twice) to run in background)` when it runs in tmux, whose prefix takes the first press. The
  key is Claude Code's `task:background` binding. One `\x02` sent with `send-keys -l` reaches Claude Code
  without going through tmux's prefix. A binding changed to another key shows another chord, and then no
  button shows (the key it would need is not known).
- The transcript records a background agent's start as the Agent call's result `{ isAsync: true, status:
  "async_launched", agentId }`, and its end as the same `<task-notification>` a command's has, with
  `<task-id>` the agent id. A command's start is `{ backgroundTaskId }`.

## Design

- Server, screen: `canBackground(screen)` in `apps/server/src/agents/claude/screen/background.ts` reads the
  offer off the joined screen. `ScreenRead` gains `background: boolean`, true only while Claude works and no
  choice or dialog is up. Codex's screen says false.
- Server, action: `POST /api/m/:machine/sessions/:id/background`. `Machine.toBackground(id)`, for a Claude
  session only, reads the screen; with the offer there it leaves copy mode, sends `\x02` and answers
  `{ sent: true }` once the screen no longer offers it (so a second press finds nothing to send); without it,
  `{ sent: false }` and nothing is pressed. The screen reaches the page through the journal as any read does.
- Server, transcript: `backgroundStarted` takes an agent's `async_launched` result too, so `backgroundRunning`
  lists it, named by the Agent call's description.
- Client: `OnScreen.background`; `sessionState` gives `canBackground` (working, not covered, offer on
  screen); `session.toBackground()` posts once however often it is pressed, rereads the screen, and when not sent says
  the command is over already.
- Web and phone: above the composer, while `canBackground`, a bar says the queued messages wait for the
  command and has the Run in background button. The background bar's title becomes "In the background"
  (it holds agents now).
- The queue tray's actions move from `libs/client/src/sessions/session.ts` to `queueActions.ts`, unchanged, to
  keep the file under the line limit.

## Paths

- Offer on screen with the plain or the tmux chord, as a line of its own → true; the words quoted inside a
  line of other text (Claude's reply) → false; another chord → false; a choice or dialog up → false; Claude not working → false.
- Pressed while the offer shows → one `\x02`; pressed after the command ended (offer gone) → nothing sent,
  `sent: false`; pressed twice quickly → the second finds no offer and sends nothing.
- Agent result async → running; its notification completed/failed/killed → gone; a foreground agent's
  result (no `isAsync`) → not listed.
