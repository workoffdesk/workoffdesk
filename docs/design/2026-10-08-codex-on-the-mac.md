# Codex conversations on the Mac

2026-10-08. The phone and the web list the Codex conversations people had on the Mac, beside the Claude ones.
Any of them can be read first and then gone on with in a WorkOffDesk session. One still open in a terminal
on the Mac is taken over: Codex quits there and goes on here, as Claude does
(2026-10-07-take-over-mac-sessions.md). `workoffdesk codex` starts a Codex session from a terminal the way
`workoffdesk claude` starts a Claude one. Codex CLI 0.160.0.

## The one rule

One process writes a Codex thread at a time. Codex keeps this rule itself, and WorkOffDesk reads it to
tell where a thread is open.

## How (all probed on 0.160.0)

- A process that opens a thread holds a flock on `$CODEX_HOME/thread-writer-locks/<thread id>.lock`
  from the moment it opens it, before any turn. This covers a terminal `codex`, `codex resume`, and an app
  server for the threads its clients joined. `lsof` on the lock files names the holder.
- A second writer is refused: `thread/resume` on another app server answers -32600 "thread … already has an
  active writer". `thread/read` and `thread/items/list` still read the thread, with no lock and no load.
- SIGTERM to a terminal `codex` frees its lock within about 100 ms. A `thread/resume` elsewhere then
  succeeds.
- A TUI started with `--remote` holds no lock: the app server it runs on does. So every WorkOffDesk
  session's thread is locked by WorkOffDesk's app server.
- The rollout (`thread.path`) records `task_started` and `task_complete` events, and the person's messages
  as `item_completed` with a `UserMessage` item. It does not record that an approval is waiting.
- `thread/list` takes about 2.5 s on this Mac whatever its filters, since it reads every session file
  (openai/codex#22411). `thread/read` takes about 1 ms and `thread/items/list` under 10 ms. `lsof` on the lock
  folder takes about 0.5 s.
- No protocol call says which clients a thread has (openai/codex#35676). The lock is the signal until one does.

## Where a thread is open

For each listed thread, its lock's holder (if any) decides:

| Holder | Where | Can go on here |
|---|---|---|
| none | nowhere | resume |
| WorkOffDesk's own app server (`--listen` on its `codex.sock`) | here | open the session that has it, or resume when none does (the server still has it loaded) |
| a Codex that is not an app server, outside every WorkOffDesk session | a terminal on the Mac | take over |
| any other process (an editor's or the desktop app's app server, a Codex inside a WorkOffDesk session, `codex exec`) | another Codex app | no |

A process is inside a WorkOffDesk session when its environment has `WORKOFFDESK_SESSION`, as for Claude.
Another app's server is never stopped: it holds every thread of that app.

A thread open in a terminal is `busy` while its rollout's last `task_started` has no `task_complete` or
`turn_aborted` after it and came after the terminal's Codex started (`ps -o lstart`), and `idle` otherwise: a
Codex quit in a turn leaves that turn unended in the rollout. A turn waiting on an approval shows as `busy`.

Only threads under the `CODEX_HOME` WorkOffDesk's own app server uses are listed, since that server can
resume no others.

## The server

- `agents/codex/threads.ts`:
  - **The list.** `thread/list` for threads with source `cli` or `vscode` (not `exec`, and not subagents),
    the latest 50. It is kept for 5 minutes, and is asked again in the background once it is older.
  - **The live part, read on every ask:** the lock holders (one `lsof` over the listed threads' lock files,
    then `ps -E` for the holders), and each rollout's tail (the last 64 KiB): busy or idle, the last thing
    the person said, and the file's mtime as the last activity.
  - A thread locked but not in the kept list (started since) is read with `thread/read` and added.
  - Asks that come in while one runs share its answer.
- `CodexAgent` gains `listThreads`, `readThread`, and `readItems`, all on its connection to the app server.
- `GET /api/recent`: the Claude and Codex conversations together, newest first, each with
  `agent: 'claude' | 'codex'`, in `RecentClaude`'s shape. A Codex row's `background` means "open in another
  Codex app". `/api/claude/recent` stays for clients not updated yet.
- `GET /api/codex/threads/:id/chat`: the thread's items as chat items (`entriesOf`), with the paging Claude's
  preview has (`from`, `before`, `sid`). Positions are item ordinals.
- `POST /api/m/local/sessions` with `kind: 'codex'`, a `resumeId`, and `takeOver`:
  - open in a session here: that session;
  - open in a terminal, without `takeOver`: 409 `open-on-mac`;
  - `now`: the terminal's Codex is sent SIGTERM and waited on for up to 10 s, then the session is started on
    the thread. The terminal is told where it went (`workoffdesk attach <id>`). If Codex does not quit in time,
    the answer is 409 `mac-would-not-quit`;
  - `whenIdle`: as for Claude, by the same wait, keyed by conversation id;
  - open in another Codex app: 409 `open-elsewhere`.
- `DELETE /api/codex/threads/:id/take-over` stops a wait.
- The control socket's open request takes `kind` (`claude` unless given); `workoffdesk codex [--resume <id>]`
  sends `codex`.

## The apps

- The Mac's list ("Other sessions on the Mac") has the Codex rows among the Claude ones, by time, drawn with
  Codex's avatar. A row opens `/codex/<id>` (web and phone): the same read-only page as Claude's, reading
  `/api/codex/threads/<id>/chat`, with the same buttons (go on here, take over now or when idle, cancel).
  A row open in another Codex app says so, and its button is off.
- "Resume a recent conversation" lists Codex rows too, marked "Codex ·".
- `RecentClaude` becomes `RecentConversation`, with `agent` (missing means `claude`).
- The hint under the list names both commands: `workoffdesk claude` and `workoffdesk codex`.

## Not done, and why

- A Codex in a terminal that waits on an approval shows as at work: the rollout does not say it waits.
- A Codex taken over does not keep its terminal's environment. Its commands run in WorkOffDesk's app server,
  not in its TUI.
- Threads under another `CODEX_HOME` are not listed: WorkOffDesk's app server cannot resume them.
- A turn the person starts in the terminal between its going idle and its quitting is lost, as for Claude.
- Once a session here ends, WorkOffDesk's app server keeps its thread loaded, and locked, for about a minute
  more; Codex has no call to close it, and the session already unsubscribes. A `codex resume` of it in a
  terminal meanwhile says the conversation is open in another app; pressing R once the minute is over goes on.
