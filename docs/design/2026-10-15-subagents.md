# What a sub-agent is doing

When Claude starts a sub-agent (the Agent tool, Task in older Claude Code), the chat shows one folded row for it:
its description, then, once it is done, the answer it gave back. What it did in between, and what it is doing
while it runs, cannot be seen from the phone, though Claude Code writes all of it down.

## What holds

A sub-agent Claude started can be followed from its row, as a conversation of its own, while it runs and after.

## What Claude Code records

Next to a conversation's transcript `<project>/<sid>.jsonl`, each sub-agent it started has
`<project>/<sid>/subagents/agent-<agentId>.jsonl`, its own transcript, and `agent-<agentId>.meta.json`:

```json
{ "agentType": "general-purpose", "description": "Saturday run", "toolUseId": "toolu_01Be…", "spawnDepth": 1 }
```

`toolUseId` is the id of the Agent call in the parent's transcript, which is the row's id in the chat. Every record
of a sub-agent's transcript has `isSidechain: true`, which the parent's chat reads as not its own and leaves out.

## Design

- `GET /api/claude/sessions/:sid/agents/:tool/chat` answers the sub-agent's conversation in the same shape and
  paging as `/api/claude/sessions/:sid/chat`. It finds the parent's transcript as that route does, then the
  `meta.json` under its `subagents` folder whose `toolUseId` is `:tool`, and reads the transcript beside it with its
  records taken as the sub-agent's own (sidechain records are not left out). `:tool` is only ever compared with
  what a meta file says, never made into a path; the transcript read is one under the parent's own folder. 404
  when there is no such sub-agent: one that has not written its meta yet, or another Claude Code's layout.
- `GET /api/claude/sessions/:sid/agents/:tool` answers `{ description }`, the page's title.
- The chat knows whose conversation it shows: in a session, the session's Claude conversation; on a
  conversation's page for the Mac, that conversation. An Agent or Task row, opened, offers "See what it did", which
  goes to `/claude/:sid/agents/:tool`: a read-only page with the sub-agent's description as its title, its
  conversation following as it is written, and a way back.
- Nothing is sent to a sub-agent; the page has no composer.

## Not in this

- Sub-agents of sub-agents: they are listed under the same folder and read the same way, but are reached only
  from their parent's page, where their rows offer the same.
- Codex: it has no sub-agents in this sense.

## Tests

- Server, unit: a sidechain record read as a sub-agent's own gives the same items as the record without the flag;
  read as a parent's it gives none.
- Server, integration: the route answers the sub-agent's chat by its tool id; 404 for an unknown tool id, a parent
  conversation with no sub-agents, or a malformed id; paging by `from` follows what is appended.
- e2e: opening an Agent row in a session and pressing "See what it did" shows the sub-agent's conversation, which
  follows what is written next; back returns to the session.
