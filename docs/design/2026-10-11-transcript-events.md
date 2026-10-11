# One reading of what the agents write down

## What must hold

Every record of a conversation, from Claude Code or Codex, is classified once, in its agent's own module, into
one typed event whose kind names the agent: `claude:prompt`, `codex:userMessage`. What the
phone shows, whether a turn is over, what Claude still holds in its queue, and how the list names and dates a
conversation are all worked out from those events, never from a record's raw fields. A new kind of record is
added in one place, and the compiler names every reader that has not said what the new kind means to it.

A record is what an agent writes down of a conversation: Claude Code's transcript lines; Codex's thread items,
its turns, and the lines of its rollout files. The app server's protocol around them (notification methods,
approval requests, rate limits) is a live API with typed methods of its own and is not turned into events.

## Why

Four readers classified records on their own: the chat, the turn, the list and the journal's titles. A kind one
of them learned about, the others did not. The summary a compaction leaves was a note to the chat but a prompt to
the turn, so an idle session showed as at work after the server restarted. Reading 600 transcripts for more of
the same found three:

- A compaction asked for with `/compact` sends its words through Claude's queue; the turn read that as a turn
  going on, so an idle conversation compacted by hand showed as at work after a restart.
- The list could take an Esc marker or teammates' messages for the last thing typed, and a skill's text that
  Claude Code adds for Claude for the conversation's first words.
- The commands Claude Code now writes as records of its own (`system`, `local_command`) were no one's.

## How

- `apps/server/src/agents/claude/transcript/events.ts`: `eventOf(record)` gives a `TranscriptEvent`, a union
  on `k` (prompt, command, results, reply, turnOver, compactBoundary, queue, …, other); `envelopeOf(record)`
  gives what a record says beside its kind (its folder, whether a program ran it). It never throws: what it does
  not understand is `other`.
- `apps/server/src/agents/codex/events.ts`: one translator per source, so the app server's camelCase items and
  the rollout's PascalCase ones are never read by the same code: `itemEventOf`, `turnEventOf`, `rolloutEventOf`.
  A file change keeps every change at its place, one with no path too: the chat names each file's tool by it.
  A rollout's lines name nothing the chat could key an entry by, so they are kinds of their own
  (`codex:rolloutPrompt`, `codex:rolloutTurnStarted`, …), and the chat's reader takes only the app server's:
  showing a rollout as a chat by mistake does not compile.
- `apps/server/src/agents/events.ts`: `AgentEvent`, either agent's, and `unhandled(e)`, which takes `never`.
- Each reader is one `switch` over every kind, ending in `unhandled(e)`: `chatItems` in `chat.ts`, `isSaid` in
  `transcripts.ts`, `entriesOfEvent` in `codex/items.ts`, and `turnSays` in `apps/server/src/agents/turnSays.ts`,
  what each event of either agent says of the turn, read by Claude's turn and Codex's rollout alike.
- A compaction asked for ends the turn: `/compact` runs only between turns. One Claude Code starts on its own
  says nothing, since it can fall in the middle of a turn.

## Checked

Codex, added the same day, changed nothing: on a frozen copy of this Mac's records, the chat entries of 1,232
items fetched from the app server, the permission card of each file change in them, the line after turns of
every status, and how 85,458 rollouts end (busy, since when, the last prompt), whole and cut at 20 points
each, are the same before and after; so are the Claude readings below, at 504,302 points.

The chat items of 757,654 records in 600 transcripts are the same before and after. The turn read at 16,848
points in them differs at 686, each one a compaction asked for that was read as a turn going on and is now read as
over. What Claude holds in its queue does not differ at any.
