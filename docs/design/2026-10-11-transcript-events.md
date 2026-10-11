# One reading of Claude Code's transcript

## What must hold

Every record of a Claude Code transcript is classified once, in one module, into one typed event. What the
phone shows, whether a turn is over, what Claude still holds in its queue, and how the list names and dates a
conversation are all worked out from those events, never from a record's raw fields. A new kind of record is
added in one place, and the compiler names every reader that has not said what the new kind means to it.

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
- Each reader is one `switch` over every kind, ending in `unhandled(e)`, which takes `never`:
  `chatItems` in `chat.ts`, `turnSays` in `turn.ts`, `isSaid` in `transcripts.ts`.
- A compaction asked for ends the turn: `/compact` runs only between turns. One Claude Code starts on its own
  says nothing, since it can fall in the middle of a turn.

## Checked

The chat items of 757,654 records in 600 transcripts are the same before and after. The turn read at 16,848
points in them differs at 686, each one a compaction asked for that was read as a turn going on and is now read as
over. What Claude holds in its queue does not differ at any.
