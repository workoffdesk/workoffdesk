# Codex sessions

2026-10-07. WorkOffDesk runs OpenAI Codex beside Claude Code: a Codex session is started from the phone
or the web, runs in a terminal the Mac can attach to, and is driven from either. Codex CLI 0.160.0.

## The one rule

A Codex session is one Codex thread that the Mac's terminal and the phone both drive. What one does, the
other sees; a question Codex asks is answered once, by whichever answers first.

## How (all probed on 0.160.0)

Codex has an app server: a JSON-RPC service over a WebSocket, here on a unix socket
(`codex app-server --listen unix://PATH`). Its own TUI can run against it (`codex --remote unix://PATH`).
Several clients on one server share its threads:

- A thread started by the TUI is announced to every client (`thread/started`, with its `cwd`).
- Status changes of every thread reach every client (`thread/status/changed`: `idle`, or `active` with
  the flags `waitingOnApproval` / `waitingOnUserInput`).
- A client that joined the thread (`thread/resume`) gets its items (`item/started`, `item/completed`,
  `item/agentMessage/delta`), its usage (`thread/tokenUsage/updated`, `account/rateLimits/updated`), and
  its approval requests (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`).
- An approval goes to the TUI and to the joined client at once. Whichever answers, the other is told
  (`serverRequest/resolved`) and the TUI's dialog closes.
- A turn started by a client (`turn/start`) shows in the TUI as if typed there. `clientUserMessageId` comes
  back as the user message item's `clientId`, so a message sent from the phone is found exactly.
- A `turn/start` while a turn runs goes into that turn, as a message typed in the TUI meanwhile does.
- A thread is written to disk at its first turn: before that, `thread/resume` fails ("no rollout found"),
  but `turn/start` and `thread/read` work, and `thread/loaded/list` names it.
- In a folder it has not been told to trust, the TUI asks first (trust this folder?) and starts its thread
  only once that is answered, however long that takes.
- With `--remote`, the TUI starts in the server's folder unless given `-C`; it asks to update at start
  unless `-c check_for_update_on_startup=false`.

So:

- **One app server per WorkOffDesk home**, in its own tmux session (`workoffdesk-codex`) on the home's
  tmux server, listening on `codex.sock` in the home. It outlives a restart of WorkOffDesk, as the
  sessions' TUIs do. It is started when the first Codex session is, and again when it is found gone.
- **A Codex session is a tmux session** (`wod-<id>`, like any other) running
  `codex --remote unix://<sock> -C <cwd> -c check_for_update_on_startup=false`, or `… resume <thread>`.
  The Mac attaches to it as to a Claude session.
- **The server is a client of the app server** (`agents/codex/`). Only the sessions' TUIs run on it, so a
  thread started in a folder (`thread/started`) is the oldest Codex session there that has none yet. What
  was started while the server was not listening is found on connecting (`thread/loaded/list`). The
  server joins each session's thread, again after every reconnect, and takes the thread's items so far
  (`thread/items/list`) into the journal.
- **Before its thread starts**, a session's screen is read for what the TUI asks (trust this folder?): the
  same numbered list Claude Code draws, so the phone shows it as a choice and answers it with keys. Only
  then: once a thread runs, what the TUI draws after a `›` is a message sent.

## What the phone gets

Nothing new: a Codex session is a session of kind `codex`, shown and answered as a Claude session is.

| Phone sees | From |
|---|---|
| Status `starting` → `idle` / `working` / `waiting` / `compacting` | spawn, the trust question on screen, `thread/status/changed`, a `contextCompaction` item |
| Conversation | items, as the journal's chat items: user message → `user`, agent message → `text`, command → `tool` + `result`, file change → `tool` + `result` with its diff, MCP and other tool calls → `tool` + `result`, compaction and an interrupted or failed turn → `note` |
| Reply being written | `item/agentMessage/delta`, as the journal's `live` |
| Permission card | approval requests, as `Ask`s: a command (`Bash`, "from now on" = the proposed exec-policy prefix), a file change (`Edit`, "from now on" = accept edits for the session) |
| Usage pill | model and effort (shown, not switched from the phone), token usage (context used), rate limits (5-hour and weekly windows) |
| Push | the same transitions as Claude: to `waiting`, and `working` → `idle` |

What the phone sends:

- A message goes by `turn/start`, idle or at work, with the message's id as `clientUserMessageId`; it
  lands when that item comes back. Messages wait in the outbox
  while the session starts, waits on a question or compacts, as for Claude. Pictures sent from the phone
  also go as `localImage` inputs.
- An answer to a permission card is the approval's reply: `accept`, the "from now on" decision, or the
  Mac's No (`cancel`, which ends the turn; `decline` when `cancel` is not offered).
- Keys and Esc are typed into the TUI, as for Claude. The phone's `/` list, model, effort and permission
  menus and Rewind are Claude Code's, and are not offered.

## Not done, and why

- Questions Codex asks (`item/tool/requestUserInput`), MCP elicitations and permission-profile requests:
  the session shows as waiting and the TUI answers them; the phone has the screen view and keys.
- Joining a TUI not on this app server while it runs: it cannot be. A thread open in a terminal on the Mac is
  taken over instead (2026-10-08-codex-on-the-mac.md).
- A thread the TUI starts itself later (`/new`) is not followed; the session keeps its first thread.
- When the TUI is quit, the session's terminal is a shell; the phone can still drive the thread.
- No hooks: the app server says everything the hooks would.
- Switching model or effort from the phone, and Codex's own `/` commands in the phone's list.
- Context used is known again only after the next turn when this server restarts.
