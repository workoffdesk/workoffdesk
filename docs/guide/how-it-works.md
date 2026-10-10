# How it works

English · [简体中文](how-it-works.zh-CN.md)

## The pieces

- **The service** is a Node server on the Mac, listening on `127.0.0.1`. It serves the web app and an API, and
  runs as a launchd agent.
- **The web app** is what the phone opens. It can be added to the home screen and receive push notifications.
  The iPhone app is a native (React Native) app on the same API.
- **tmux** holds the sessions, on a tmux server of the service's own (`tmux -L workoffdesk`).

## Sessions live in tmux

Each session is a tmux session named `wod-<id>`. Claude runs inside it, then a login shell. The phone never
holds a terminal: keys go in with `tmux send-keys`, and a message as one paste (bracketed
when the program asks for it) followed by Enter. Because tmux owns the
session, closing the page, locking the phone or restarting the service does not end it, and
`workoffdesk attach` joins the very same session from a Mac terminal.

## The chat comes from the transcript

Claude Code writes each conversation to `~/.claude/projects/<folder>/<session>.jsonl`. The service reads only
what is new, and pushes it to the phone over the session's WebSocket. The phone keeps what it has read
(IndexedDB, the newest 1500 items per session), so a session opens instantly and only new lines are fetched.

## Status comes from hooks

Every Claude the service starts gets `--settings` with hooks for its events (a prompt sent, a tool used, a
notification, stop, compaction, session start and end). Each hook posts to a Unix socket in the service's home,
readable by you only. That is how the list knows Claude is working or waiting, and when to notify you. Your own
Claude Code settings are not changed.

## Choices are read from the screen

What the transcript does not say, the screen does: the options of a question or permission prompt, the boxes of
a multi-select question, an open panel like `/usage`. The service reads the pane (`tmux capture-pane`) to find
them. Before pressing anything for you it reads the screen again, and presses only if the options are still the
ones you saw.

## Messages wait when Claude cannot take them

While Claude works, a message goes straight in, into Claude Code's own queue. While Claude is starting, asking
you something, compacting its context, or has ended, typing would go to the wrong place, so messages wait on the
Mac, in `journal.db`, in order. They go in as soon as Claude can take them, and survive a restart of the service.

## Codex goes through its app server

Codex has an app server that several clients can share. The service runs one per install, in its own tmux
session, on a Unix socket in its home; each Codex session is Codex's terminal UI connected to it. The service
joins the same thread, so it hears every message, status change and permission request as they happen, and
sends what you type from the phone as a turn of that thread. Neither hooks nor the screen are needed for that.

## Taking over a terminal's Claude

`claude agents --json` lists the Claude Code sessions running on the Mac. One that is in no workoffdesk session
(it has no `WORKOFFDESK_SESSION` in its environment) can be taken over: the service sends it SIGTERM, which
quits it as Ctrl-C does with its transcript written, then resumes the conversation in a new session with the
environment that Claude had. One conversation never has two Claudes writing it at once from here.

## Security in one paragraph

One user per install, with a password (stored as a scrypt hash) and passkeys. Sign-ins last 30 days and can be
revoked. Failed sign-ins lock out the address, then everyone, for a while. Requests that change anything, and
every WebSocket, must come from the configured origin. The page loads nothing from other sites. See
[SECURITY.md](../../SECURITY.md).
