# A name given here is the conversation's name in Claude and Codex too

Renaming a session in WorkOffDesk changed only what WorkOffDesk showed. Claude's `/resume` list and Codex's
thread list kept the old name, and a Claude conversation that had been named with `/rename` took its old name
back here: a running Claude writes the name it holds into its transcript again and again (hundreds of
`custom-title` records in one long transcript), and each was read as a new `/rename`.

## What must hold

A name given in WorkOffDesk becomes the conversation's name in its agent, and nothing the agent still held
from before takes it back. A name given in the agent (`/rename` at the Mac) still shows here. A session's name
is never empty: the rename sheet takes no empty name, and the server turns one down.

## What was found

- Claude keeps its conversation's name in memory and writes it to the transcript on each turn. A
  `custom-title` record appended from outside is overwritten by the next turn's.
- `/rename <name>` typed at Claude's prompt takes effect at once, also while Claude is at work, without
  stopping the turn. It records `custom-title` and `agent-name`, and a local command note.
- `claude --name <name>` names a new conversation, and, with `--resume`, renames the one gone on with.
- Codex's app server answers `thread/name/set` (`threadId`, `name`) and says `thread/name/updated`.

## Ways it could break

| How | Then |
| --- | --- |
| Renamed while Claude waits at its prompt | `/rename` is typed at once |
| Renamed while Claude works | the same: it does not wait for the turn |
| Text half typed at the Mac's prompt, or a dialog open | nothing is typed; tried again until the prompt is free |
| Claude writes its old name before taking the new one | ignored while the new one is on its way |
| Typed and not taken (screen moved on) | typed again after a while, not on every check |
| Claude not running (quit, moved to another account, gone on with later) | it is started with `--name`; an ended one is not looked at until then |
| A new Claude session given a name | started with `--name` |
| Renamed at the Mac with `/rename` afterwards | shows here, as before |
| The server restarts while a name is on its way | the name on its way is kept with the session |
| A Codex session renamed before its thread started | named once the thread is known |
| A new Codex session given a name | the same |
| An empty name | turned down |

## Who knows

Claude's process holds its conversation's name; only it can change it, through `/rename` or `--name`. The
server knows whether Claude runs, what its screen shows, and what its transcript records. Codex's app server
holds a thread's name.

## Pieces

- `SessionMeta.naming`: the name given here that the agent has not taken yet.
- `renameSession`: turns down an empty name; sets the title, `named`, and `naming`, then gives the name.
- Giving the name: Codex, `thread/name/set` once the thread is known; Claude, while it runs, `/rename` when
  the screen shows no dialog and nothing typed at the prompt, at most once every 30 seconds. A check every few
  seconds while any name is on its way.
- `conversationNamed`: while `naming` is set, a `custom-title` that is the name clears it; any other is not
  taken.
- `claudeCommand`: `--name` with the session's title when it was given one here.
- The screen read: `typed`, the text at Claude's prompt that is not its dimmed suggestion.
- The rename sheet: Save off while the name is empty; its note says the name goes to Claude or Codex too, not
  what an empty one does.
