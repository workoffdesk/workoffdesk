# Sessions kept, and every conversation on the Mac found

## What must hold

1. A Claude or Codex session opened through WorkOffDesk stays in the list, and what was said in it can be read,
   until a person deletes it. Ending it, its agent quitting, tmux losing it and the Mac restarting do not take it
   off, and neither does Claude Code deleting the conversation's transcript.
2. Every conversation people had on the Mac, in Claude Code or Codex, that the agent still keeps can be found from
   the apps, however old it is.

## What the agents keep

- Claude Code deletes a transcript under `~/.claude/projects/` at startup once it is older than
  `cleanupPeriodDays`, 30 days unless set otherwise. `--resume` reads the same file, so after that a conversation
  cannot be gone on with, by anyone.
- Codex keeps every rollout under `~/.codex/sessions/`; archiving a thread only hides it from its list.

## Who knows what

- tmux knows which sessions run. The store (`state.json`) knows what each session is: its kind, folder, name and
  conversation. The journal (`journal.db`) holds what each session's page shows, taken in from the start of the
  conversation's transcript (Claude) or handed over by the app server (Codex). So the journal already holds a copy
  of the whole conversation that does not depend on the agent keeping its own.
- Until now a session gone from tmux was taken out of the store and its journal rows deleted
  (`Status.forget`). Keeping both is all that 1 needs on the Mac.

## Past sessions

- The store gets `past`: by session id, what the session was (`SessionMeta`), with `lastActivity`, when something
  last happened in it. A Claude or Codex session that leaves tmux, however it leaves, moves there; its journal rows
  stay. A shell session is dropped as before: there is nothing of it to read.
- A conversation is held by at most one session here, running or past. A past session is not listed while a running
  one holds its conversation. When a session moves to the past and a past one already holds the same conversation,
  the one whose journal has fewer items of it is deleted, the older on a tie.
- The list (`GET /api/m/:machine/sessions`) gives past sessions too: running and past together, by last
  activity. A past one has `past: true`, status `ended`, no usage.
- `DELETE /api/m/:machine/sessions/:id` ends a running session, which moves it to the past, and deletes a past one:
  its entry and its journal rows. Claude's and Codex's own records are never touched.
- `PATCH` renames a past session as it does a running one, here only: no agent runs to take the name.
- The journal routes (`/journal`, `/journal/items`) answer for a past session as for a running one. The session's
  socket still closes with 4404: nothing runs to watch.

## Going on with a past session

`POST /api/m/:machine/sessions/:id/continue` on a past session brings it back in place: the same id, name and
journal, in a new tmux session, resuming its conversation (`--resume` for Claude, the thread for Codex). A resume
asked for any other way (the new-session sheet, the conversations on the Mac) of a conversation a past session
holds goes into that session the same way.

- A Claude conversation whose transcript is gone is refused before anything starts, with
  `409 conversation-gone`; the apps say that Claude no longer keeps the conversation (it deletes them after 30 days
  unless set to keep them longer) and that it can still be read here. A Codex thread the app server no longer has
  is refused the same way.
- A folder that no longer exists is refused as a resume of one is now.

## Every conversation on the Mac

`GET /api/conversations?q=&before=&limit=` gives the conversations on the Mac, newest first, at most `limit` (50
unless asked) with a last activity before `before`, and `more` when there are others after them.

- Claude: every transcript Claude Code still has, read as the recent list reads them (the parse is cached by file
  size and time, so it is read once). Codex: every thread people opened (`cli`, `vscode`), all pages of
  `thread/list`.
- Left out: conversations started by programs (`automated`), those in a temporary folder, and those a session here
  holds, running or past (they are in the list).
- `q` keeps those whose title, folder or last prompt has it, ignoring case.
- Each has the shape of `/api/recent`'s, so a row opens the same read-before-picking-up page.
- `GET /api/conversations/:agent/:sid` gives one of them in that shape, however old, or 404 when the agent keeps
  none by that id. The read-before-picking-up page asks it for its conversation, so a row from any list opens a page
  that can pick it up; until the Mac answers, its button shows it is asking.

## In the apps

- The list's header gets a button left of **+** (a clock) that opens **Conversations on the Mac**: a search box,
  the conversations grouped by day (Today, Yesterday, then the date), more as the page is scrolled to its end. A row
  opens the conversation's page, from which it is picked up as now. The list keeps its own section of the last
  24 hours.
- A past session's row is drawn as a Mac conversation's is (its picture faded), without a status.
- Holding a row (phone) opens a menu: **Rename**, **End session** for a running one or **Delete** for a past one,
  **Cancel**. Swiping a row (web) shows the same two beside each other. Delete asks first, saying the conversation
  will be gone from WorkOffDesk and that Claude's or Codex's own record is left as it is.
- A past session's page shows its conversation, and in the box's place «This session has ended» with **Continue
  this conversation**.
- The list's search finds past sessions as it finds running ones: by name and folder.

## Not done

- Search inside what was said.
- A limit on how much the journal keeps; past sessions stay until deleted.
- Asking Claude to take a name given to a past session.
