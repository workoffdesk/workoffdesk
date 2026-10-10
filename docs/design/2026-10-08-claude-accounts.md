# Which Claude account runs the sessions

2026-10-08. A Mac can be signed in to more than one Claude account: Claude Code keeps each one in a config dir of
its own, picked by `CLAUDE_CONFIG_DIR`. When one account's limits run low, the next sessions should run on
another. The This Mac page lists the accounts on the Mac, says what each one had used when last seen, and a tap
picks the one new sessions run on. With one account, none of this shows.

## The one rule

A conversation can be gone on with on any account the page offers. So only an account that keeps its
conversations in the folder this server reads (`claudeProjectsRoot`) is offered. An account kept apart is listed
with why, and cannot be picked: its sessions would write transcripts the server never reads.

## How Claude Code keeps accounts (Claude Code 2.1.294, probed)

| | The default | Any other |
|---|---|---|
| Folder | `~/.claude`, with `~/.claude.json` beside it | `<dir>`, with `<dir>/.claude.json` inside |
| Token | Keychain item `Claude Code-credentials` | Keychain item `Claude Code-credentials-<first 8 hex of sha256(dir)>` |

- Setting `CLAUDE_CONFIG_DIR=~/.claude` is not the default: Claude Code then looks for the hashed Keychain item
  and says it is signed out. The default is the variable unset.
- `.claude.json` names the account in `oauthAccount.emailAddress`.
- `security find-generic-password -s <item>` without `-w` reads only the item's attributes: no prompt, from a
  launchd service too. The item missing means signed out.
- Superset's "Add account" and the like link `projects`, `sessions` and the rest of the new folder to
  `~/.claude`'s, so conversations and running Claudes are shared.

## The server

`agents/claude/accounts.ts`:

- **Finding them**, read anew when the last read is over 10 s old (sessions are listed often): the default
  (`~/.claude.json`), the server's own `CLAUDE_CONFIG_DIR` if it has one, and every folder `~/.<name>` or
  `~/.config/<name>` holding a `.claude.json` with an `oauthAccount.emailAddress`. One folder reached by two
  paths (a symlink) is one account. Each one says:
  - `id`: its folder, or `""` for the default;
  - `email`;
  - `signedIn`: its Keychain item is there, or a `.credentials.json` in its folder;
  - `shared`: `realpath(<folder>/projects)` is `realpath(claudeProjectsRoot)`;
  - `ready`: its `.claude.json` has `hasCompletedOnboarding`. Without it Claude Code opens its first-run
    wizard, which no one at the phone can get through;
  - `limits`: what it had used when last seen (below).
- **Picking one.** `state.claudeAccount`, the `id` picked; unset until one is. `PUT /api/claude/account
  { id }` sets it. `id` is matched exactly against the accounts found, never used as a path of its own; one
  not found, not signed in, not ready or not shared is refused (409).
- **In use.** The picked account while it can still be picked; otherwise the server's own. The page shows the
  one in use, so what it says is what runs. (Until one is picked, a login profile exporting
  `CLAUDE_CONFIG_DIR` can still put sessions on another account than the one shown; picking one settles it.)

Starting a Claude (`machine.ts` `startSession`):

- A session from the phone or the web, new or going on with a conversation, runs on the account in use. Once one
  is picked, the command says so after the login shell has read its profile:
  `CLAUDE_CONFIG_DIR=<dir> claude …`, or `env -u CLAUDE_CONFIG_DIR claude …` for the default. Never picked: the
  command is as before.
- A session taken over from a terminal, or opened by `workoffdesk claude`, keeps the terminal's environment
  (`fromTerminal`) and so its account. The pick does not apply.
- The session keeps the folder it runs on in its meta (`SessionMeta.claudeDir`, `""` for the default), from the
  pick or from the terminal's `CLAUDE_CONFIG_DIR`.
- A running session keeps its account. A pick applies from the next start.

What each account used:

- The status line reports a session's `rate_limits`. Each report is also kept under the session's account:
  `state.claudeLimits[id] = { fiveHour, sevenDay, at }`, written when a percentage moves by a whole point or a
  reset time changes, so not on every report. A session started before this, whose account is not known,
  adds to none.
- A limit whose `resetsAt` has passed is shown as reset, not as its old percentage.
- No Keychain token is read and no usage endpoint is called: only what Claude Code already reported.

`GET /api/claude/accounts` → `{ accounts: Account[], inUse: string, picked: boolean }`. Sessions (`/api/m/:machine/sessions`
and the events socket) carry `claudeAccount` (the email) only when the Mac has two or more accounts.

## The phone and the web

The This Mac page gets a "Claude account" section, only when there are two or more accounts:

- one row per account: the email; under it the folder (`~/.claude-work`) and what it used when last seen
  ("5h 12% · 7d 87% · 3 min ago"), or "not seen yet";
- the one in use has a check; a tap on another picks it, with no confirmation (it is undone the same way);
- a row that cannot be picked is dimmed and says why: signed out, "set it up in a terminal first", or
  "conversations kept apart";
- a note under the section: "New sessions start on this account. Running ones keep theirs."

A Claude session's panel (the card with its usage) says the account's email, only on a Mac with two or more.

## Not done

- Picking an account per session in the New session sheet.
- Moving to another account by itself when one's limits run low. A session a limit stopped can be moved by
  hand from the note it leaves: `docs/design/2026-10-09-limit-folder-loading-commands.md`.
- Reading the Keychain token to ask Anthropic for live usage.
- Linking a new account's folders to `~/.claude` (Superset and the like do that when they add one).
