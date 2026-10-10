# A conversation's folder is the one it last ran in

2026-10-10. A conversation started in one worktree and resumed in another was listed under the first. Once
the first worktree was removed, the phone said the folder was gone and offered no way on, while Claude was
still at work in the second.

## What must hold

The folder a conversation is listed in, resumed in and judged gone by is the one its Claude last ran in.

## What Claude Code writes

- Every transcript record carries `cwd`: the folder Claude's shell is in when the record is written. A `cd`
  into a subfolder changes it; a `cd` out of the project is undone before the next record (seen in
  transcripts of Claude Code 2.1.295 and 2.1.296).
- `claude --resume <id>` finds the transcript from any folder and keeps writing the same file, from then on
  with the new folder's `cwd`. The file stays under the projects folder named after the first one.
- No record names the folder Claude was started in.

So within one run every `cwd` is the run's folder or a folder inside it, and a run in another folder starts
a stretch of `cwd`s that are neither.

## The rule

`conversationFolder(cwds)` in `apps/server/src/agents/claude/transcript/transcripts.ts` walks the records
from the newest back. It starts at the last `cwd`, moves up to any folder above it that it meets, passes
folders inside it, and stops at the first that is neither: the start of an earlier run elsewhere.

- Started in `/a`, resumed in `/b`: `/b`.
- Resumed in `/b`, last records from `/b/sub`: `/b`.
- Only ever in `/a`: `/a`, as before.

The listing reads a long transcript's first 256 KB and last 64 KB. When the last run's records reach back
past both, the folder found can be one inside the run's folder; it is still a folder that run was in.

## Where it shows

`GET /api/claude/recent` and `/api/recent` give it as `cwd` and judge `folderGone` by it, so the read-only
page, the list's note and taking a conversation over use it with no change of their own. The folders offered
to start a session in (`GET /api/claude/projects`) leave out recent ones that are gone; pinned ones stay.
Codex threads carry the folder Codex gives and are not changed.
