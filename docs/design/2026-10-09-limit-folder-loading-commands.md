# Four fixes: a limit hit, a folder gone, a session still loading, a command typed

2026-10-09. Four things the phone got wrong, each fixed where the fact it needs is known.

## 1. A limit hit offers another account

**What must hold.** When Claude stops because its account hit a limit, and the Mac has another account a
conversation can go on on, going on there is one tap from the note, or from typing the next message; and what is
said next reaches the Claude on the new account, never the one at its limit.

- Claude Code writes the failed reply as an assistant record with `isApiErrorMessage: true` and
  `error: "rate_limit"` (probed on Claude Code 2.1.295: "You've hit your weekly limit · resets 4pm"). The
  transcript reader (`apps/server/src/agents/claude/transcript/chat.ts`) gives that note
  `event: { e: 'failed', limit: true }`. Nothing on the phone parses the words.
- The note says "Usage limit reached" instead of "Something went wrong", and keeps its "Try again".
- Moving is the Mac's own (`docs/design/2026-10-09-move-sessions-to-account.md`): pick the account
  (`PUT /api/claude/account`), then move the open sessions to it (`POST /api/claude/account/move`), each between
  turns. The page adds no way of its own; an account that hit a limit would hit it again in every session on it,
  so all of them go.
- Under the note, when it is the last one and the Mac has an account other than the session's that can be picked
  (signed in, set up, sharing conversations, not another folder of the same address): **Go on with another
  account**, which lists them with their folder and the limits last seen. With none, the note says how to add
  one: `CLAUDE_CONFIG_DIR=~/.claude-<name> claude` and `/login`.
- A message typed while the chat is stopped on the limit opens the same list first, saying the message waits.
  Closing the list puts it back in the composer; there is no "send it here anyway", which would only meet the
  same limit again. A `/command` is sent as
  typed.
- What is said next ("continue", or the typed message) waits on the page until the session's account, as the
  session list reports it, is the one picked; the note says "Moving to …" meanwhile. Sent at once it would reach
  the old Claude before the move quits it. `libs/client/src/sessions/moveAccount.ts` holds this, the same for the
  web and the iPhone app.
- A session whose folder is gone is not moved: its Claude is left as it was rather than quit with nowhere to start
  again (`Lifecycle.moveClaude`).

### This Mac

- The open sessions on another account showed as one blue line, "Move 1 open session to this account", among the
  accounts, with nothing saying which account "this" was. They now show under the list as a block of their own:
  how many are on another account, "Move to <the account checked>", and a **Move** button; while they wait for
  their turn to end, how many are moving and to where, with a spinner. The note under the list ("new sessions
  start on the account checked") shows only when neither does, as it says the same.
- Each account offered is shown by its folder, and its limits only when any were seen.

## 2. A conversation whose folder is gone

**What must hold.** The phone never offers to pick up a conversation whose folder is gone; it says so instead.

- A worktree removed while a Claude was open in it left the conversation listed with **Take over to phone**,
  which answered `cwd is not a directory: …` in English after the tap. The check ran before the Mac's Claude was
  stopped, so nothing was lost, but the button could never work.
- `/api/recent` and `/api/claude/recent` give each conversation `folderGone: true` when its folder is not a
  directory now. `pickUpOf` gives `{ do: 'gone' }` for one not open here; the conversation page shows a disabled
  button "Its folder is gone" in place of every pick-up button; the list says "Folder gone" and does not open it
  for resuming.
- A request that reaches the server anyway (the folder removed after the list was read) is refused with code
  `folder-gone`, said in the phone's language.

## 3. The pill under the composer while the session loads

**What must hold.** Where the model, permissions and usage will be, something shows from the first frame.

- Before the session list arrives the page does not know whether the session is Claude's, Codex's or a shell,
  and drew nothing under the composer. It now draws a pulsing placeholder pill of the same height there, until
  the kind is known; a shell's then goes away, as it has no pill.

## 4. A command typed into the composer

**What must hold.** A message the phone sent lands once the transcript records it, whether Claude Code recorded
it as a prompt or as a command.

- Typed `/exit`, `/clear` or `/cost` is recorded as `<command-name>/exit</command-name>`, which the reader shows as
  a command note, not a user prompt. Landing only looked at prompts, so a command never landed: the message
  ended `unconfirmed` and its bubble stayed under the conversation until the next prompt.
- The command note now says it is one (`command: true`), and landing matches a message against a prompt or a
  command note, the same way (its words, sent no later than recorded).
- On the day this was seen the phone's requests were also timing out for a minute, which is why the bubble read
  "Sending…" so long; that part was the network.

## Tests

- The end-to-end server ran with the accounts of whoever ran it, read from their home. It now has its own: a
  default and one more under its throwaway home (`apps/server/tests/e2e/server.ts`), so the limit tests move a
  session between them for real, and no one's address can reach a screenshot. It also has a This Mac report (no
  releases, nothing to check), so that page can be tested.
- Its fake Claude quits at once; while a test writes `claude-stays` in that home, it stays at its prompt, as
  Claude does after a limit.

