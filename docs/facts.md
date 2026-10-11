# Facts

Every sentence in the READMEs and `docs/guide/` must be backed by a line here, and every line here names
where it was checked. A pull request that adds a claim to the docs adds or updates its fact here.
Checked against the source on 2026-10-07 unless a line says otherwise.

## Install and run

- The service runs on macOS only: it is installed as a launchd agent. (`apps/server/src/commands/install.ts`, `apps/server/src/ops/doctor.ts`)
- It needs Node 22.13 or later (`MIN_NODE`), tmux 3.3 or later (`MIN_TMUX`), and Claude Code, found in
  `~/.local/bin` or on `PATH`. (`apps/server/src/system/node.ts`, `apps/server/src/ops/doctor.ts`, `apps/server/src/http/serve.ts` `resolveClaude`)
- `install.sh` installs tmux and Node from Homebrew when they are missing, installs the npm package, runs
  `workoffdesk doctor`, and never calls `sudo`. It stops on anything but macOS and without Homebrew. Run in
  a terminal on a Mac with no `config.json` yet, it goes on to `workoffdesk setup --web`; otherwise it prints
  the commands. (`install.sh`, `apps/server/tests/integration/install.sh.test.ts`)
- Commands: `setup [--web]`, `serve`, `doctor`, `status --json`, `activity --json`, `start`, `stop`, `restart`, `claude [--resume <id>]`,
  `attach [id]`, `install`, `deploy <build folder>`, `rollback`; `--version` prints the installed version.
  (`apps/server/src/cli.ts`)
- `setup --web` serves the setup in the browser from a second server on `127.0.0.1` at a free port, opens it,
  and prints its address. It answers only requests that carry the token from that address's fragment, name
  `127.0.0.1:<port>` as the host, and, for a change, come from that page; it ends when the page says done,
  on Ctrl-C, or after 30 minutes unused. Its steps: the checks, the account (the same rules as `setup`), the
  address (Tailscale's `https://<name>.ts.net` with `tailscale serve --bg <port>`, a Cloudflare tunnel there
  is, or one typed), the service (what `install` writes, started, and waited for up to 30 seconds), then the
  address as a QR code. (`apps/server/src/commands/wizard/server.ts`, `apps/server/src/commands/setupWeb.ts`,
  `apps/server/tests/integration/commands/wizard/server.test.ts`)
- `start` loads the service's launchd agent (or starts it when loaded) and waits up to 30 seconds for it to
  answer; `stop` unloads it, so it stays stopped until the next login or `start`; `restart` asks it to stop
  with SIGTERM, waits up to 12 seconds, and starts it again. (`apps/server/src/ops/service.ts`, `apps/server/src/commands/service.ts`)
- `status --json` prints the checks, the version and build, the releases, the service's home and address, whether
  it runs, and the newest 20 warnings and errors in its log. (`apps/server/src/commands/status.ts`,
  `apps/server/tests/unit/cli.test.ts`)
- Everything lives in `~/.workoffdesk` (`WORKOFFDESK_HOME` moves it), created with mode 700.
  (`apps/server/src/system/paths.ts`)
- `setup` asks for a username and a password of at least 12 characters and writes `config.json`; running
  it again replaces the password and signs every device out. (`apps/server/src/commands/setup.ts`)
- `setup` and a passing `doctor` print the address as a QR code when it is HTTPS. (`apps/server/src/commands/common.ts` `showQr`,
  `apps/server/src/commands/qr.ts`)
- `doctor` checks macOS, Node, tmux, Claude Code, Codex (which never fails, being optional), setup, the service on its port (and that it runs the
  same version as the command), the address, idle sleep and the iPhone push key, prints what to do for
  each failure, and exits 1 if any fails. (`apps/server/src/ops/doctor.ts`)
- `install` writes the launchd agent and `~/.local/bin/workoffdesk`, starts nothing, and prints the
  commands to run; with `--tunnel <name>` it also writes a launchd agent and `cloudflared.yml` for an
  existing Cloudflare tunnel, and never touches `~/.cloudflared/config.yml`. (`apps/server/src/commands/install.ts`)
- The server listens on `127.0.0.1` only. (`apps/server/src/commands/serve.ts`)
- `serve` runs the server in the terminal it is started from; the launchd agent `install` writes runs the same
  command. (`apps/server/src/commands/serve.ts`, `apps/server/src/commands/install.ts`)
- `--help`, `-h`, `help` and no command at all print every command with one line on what it does, in the
  language of `LC_ALL`, `LC_MESSAGES` or `LANG` (else the system's), and exit 0; a command that does not
  exist prints the same list to stderr and exits 1.
  (`apps/server/src/cli.ts` `helpText`, `apps/server/src/system/messages.ts` `cli.help`)
- workoffdesk has no account and no service of its own: the only server is the one on your Mac, and the
  phone reaches it over whatever HTTPS path you put in front. The server's only
  outbound connections are web push to the browser's push service and APNs for the iPhone app; `doctor` also
  asks your own address for `/healthz`. (`apps/server/src/notify/push.ts`, `apps/server/src/notify/apns.ts`,
  `apps/server/src/ops/doctor.ts`)
- While the service runs it keeps the Mac from idle sleep with `caffeinate -i -w <pid>`: the display still
  sleeps, closing the lid still sleeps the Mac, and the assertion ends with the service. `"preventSleep": false`
  turns it off. (`apps/server/src/ops/awake.ts`, `apps/server/tests/unit/ops/awake.test.ts`)

## Upgrade

- `deploy` copies a build folder into `releases/`, smoke-tests it, switches `app` to it and restarts the
  service; a build whose `dist` was not built for its `package.json` version is refused; one that does not
  report its version on `/healthz` within 30 seconds is switched back; the newest 3 releases are kept.
  `rollback` goes back to the release before. (`apps/server/src/ops/release.ts`)

## This Mac

- Settings → This Mac, in the web app and the iPhone app, shows the checks `doctor` runs (in the phone's
  language), the version, the build's commit, when the release began serving, the releases kept, and the
  newest 50 warnings and errors in `logs/workoffdesk.log` and `.1`, each opening to its detail.
  (`apps/server/src/http/routes/mac.ts`, `ops/report.ts`, `ops/problems.ts`, `apps/web/src/pages/Mac.tsx`,
  `apps/mobile/src/app/mac.tsx`)
- Restart and Roll back on that page are done by the `workoffdesk` command the service runs, started apart from
  it so it outlives the restart; the page waits up to 60 seconds for the service to say how it ended. Both
  are refused when the service was not started by launchd, while one is running, and a rollback when the
  release before is no longer the one the page named. Restarting does not end sessions.
  (`apps/server/src/http/routes/mac.ts`, `apps/server/src/ops/lastOp.ts`, `libs/client/src/mac/macPage.ts`,
  `apps/server/tests/integration/http/routes/mac.test.ts`)
- When the Mac has more than one Claude account (a config dir of its own each, picked by `CLAUDE_CONFIG_DIR`,
  found as `~/.claude` and the dirs in `~` and `~/.config` holding a signed-in `.claude.json`), This Mac lists them,
  each with its folder and what its sessions last reported of the 5-hour and 7-day limits. The one picked runs the
  sessions started from the phone or the web, new and continued; running sessions keep theirs until moved, and one taken over
  from a terminal keeps that terminal's. Only an account signed in, through Claude Code's first run, and sharing
  `~/.claude/projects` can be picked; one that is not says why. (`apps/server/src/agents/claude/accounts.ts`,
  `apps/server/src/sessions/machine/accounts.ts` `accountInUse`, `apps/server/src/http/routes/claude.ts`, `libs/client/src/mac/usage.ts` `accountLine`,
  `docs/design/2026-10-08-claude-accounts.md`, `apps/server/tests/unit/agents/claude/accounts.test.ts`)
- Open Claude sessions on another account than the one picked can be moved to it, from This Mac, the menu bar
  app, or `workoffdesk account move` (`use <email|folder> --move` picks and moves). Each moves between turns:
  when it is idle with nothing it was sent still waiting, being pasted or queued in Claude; one working moves
  once it is idle. Moving quits its Claude (SIGTERM, waiting up to 5 s) and starts it again in the same pane
  resuming the same conversation on the account in use; a message sent meanwhile waits for it. A session
  started from a terminal is not moved, and a move is refused before any account is picked. The mark to move
  is kept in the store across restarts. (`apps/server/src/sessions/machine/moves.ts`,
  `apps/server/src/sessions/machine/lifecycle.ts` `moveClaude`, `apps/server/src/sessions/control.ts`,
  `apps/server/src/commands/account.ts`, `apps/server/src/http/routes/claude.ts`, `libs/client/src/mac/macPage.ts`,
  `apps/mac/Sources/WorkOffDeskKit/Accounts.swift`, `docs/design/2026-10-09-move-sessions-to-account.md`,
  `apps/server/tests/integration/sessions/machine.moves.test.ts`)
- A reply a usage limit stopped is read from Claude Code's transcript (`isApiErrorMessage` with
  `error: "rate_limit"`) as a limit, and says so. With another account that can be picked, the phone and the web
  offer to go on on it, from the note or when a message is typed while stopped: the account is picked and the open
  sessions move to it (`PUT /api/claude/account`, `POST /api/claude/account/move`), and "continue" or the typed
  message is sent only once the session runs on that account. A session whose folder is gone is not moved. With no
  other account the note says how to sign in to one.
  (`apps/server/src/agents/claude/transcript/chat.ts`, `libs/client/src/sessions/moveAccount.ts`,
  `apps/server/src/sessions/machine/lifecycle.ts` `moveClaude`, `docs/design/2026-10-09-limit-folder-loading-commands.md`,
  `libs/client/tests/sessions/moveAccount.test.ts`, `apps/server/tests/integration/sessions/machine.moves.test.ts`,
  `apps/server/tests/e2e/chat.spec.ts`)
- A conversation whose folder is no longer a directory is marked `folderGone` in the recent lists; the phone and
  the web say so and offer no way to go on with it, and a request that comes anyway is refused with `folder-gone`.
  (`apps/server/src/http/routes/claude.ts`, `libs/client/src/sessions/newSession.ts` `pickUpOf`,
  `apps/server/tests/integration/http/app.claude.test.ts`, `apps/server/tests/e2e/sessions.spec.ts`)
- A conversation opened from the Mac's list that cannot learn what the Mac says of it (no network) says so
  and asks again every 3 seconds; going on with it is offered once the Mac answers.
  (`libs/react/src/macConversation.ts`, `apps/server/tests/e2e/sessions.spec.ts`)
- A Claude conversation's time in the lists is when its last message was said, by the person or Claude, read
  from the transcript; what Claude Code writes when nothing is said (a recap while away, the title and mode
  when it is opened) does not move it. A transcript whose messages carry no time falls back to when the file
  was written. (`apps/server/src/agents/claude/transcript/transcripts.ts`,
  `apps/server/tests/unit/agents/claude/transcript/transcripts.test.ts`)
- A Claude conversation's folder is the one it last ran in: resumed in another folder, it is listed, judged and
  picked up there, and a `cd` into a folder inside it does not change it. The folders offered to start a session
  in leave out recent ones that are gone. (`apps/server/src/agents/claude/transcript/transcripts.ts`,
  `docs/design/2026-10-10-conversation-folder.md`,
  `apps/server/tests/unit/agents/claude/transcript/transcripts.test.ts`,
  `apps/server/tests/integration/http/app.claude.test.ts`)
- The menu bar app (`apps/mac`, macOS 13 or later) runs `workoffdesk status --json` when its menu opens and
  every minute, and `start`, `stop` and `restart` when asked. It finds the command in `~/.local/bin`, then
  `/opt/homebrew/bin` and `/usr/local/bin`. Its icon shows running, a problem, or stopped; while running, it is
  the app's mark, with a bar across its screen while any session is working or compacting, followed through
  `workoffdesk activity --json` (`docs/design/2026-10-11-menu-bar-working.md`); the menu shows
  the failed checks with their fixes (copied on a click), the three newest errors, the address as a QR code,
  Open in Browser, Open Logs Folder, Open at Login; with two or more Claude accounts and the service running,
  the accounts (`workoffdesk account --json`), a click picking one, and moving the open sessions to it.
  `apps/mac/scripts/build-app.sh` builds it as
  `WorkOffDesk.app`, signed ad hoc for this Mac only. (`apps/mac/Sources`, `apps/mac/Tests`)

## Security

- One user per install. Passwords are stored as scrypt hashes; passkeys (WebAuthn) can be added after
  signing in. (`apps/server/src/http/auth/password.ts`, `routes/auth.ts`)
- Five failed sign-ins from one address within 15 minutes lock that address for 15 minutes; twenty from
  anywhere within an hour lock sign-in for an hour. Attempts go to `logs/audit.log`. (`apps/server/src/http/auth/lockout.ts`)
- A sign-in lasts 30 days; signed-in devices are listed in Settings and can be revoked.
  (`apps/server/src/http/auth/sessions.ts`, `auth/guard.ts`)
- Requests that change anything, and every WebSocket, must come from the configured origin.
  (`apps/server/src/http/app.ts`)
- The Content Security Policy loads everything from the site itself (images also from `data:`) and forbids
  framing the page. Images from the web in Claude's replies are shown as a "Web image" link with the host,
  never loaded. The server does not trust `X-Forwarded-*` headers (`trustProxy: false`).
  (`apps/server/src/http/app.ts` `CSP`, `apps/web/src/components/turn/Reply.tsx`)

## Remote access

- Cloudflare terminates TLS at its edge: it keeps one connection with the visitor and another with the
  origin. (Cloudflare docs, SSL/TLS encryption modes, read 2026-10-07)
- A Cloudflare tunnel makes outbound connections only; no inbound port is opened. (Cloudflare docs,
  Connect networks, read 2026-10-07)
- `tailscale serve --bg <port>` serves a local port over HTTPS to devices on the tailnet, with a
  certificate for the machine's tailnet name; Tailscale's docs do not say whether WebSockets pass
  through. It needs HTTPS certificates turned on for the tailnet; `tailscale serve reset` turns it off; only
  devices in the tailnet, and people the machine is shared with, can reach it. (Tailscale docs, Serve and
  `tailscale serve` command, read 2026-10-07; `tailscale serve --help` 1.102.3)
- `cloudflared tunnel --url http://127.0.0.1:<port>` opens a quick tunnel without a domain or an account and
  prints a new `https://<words>.trycloudflare.com` address on each start; it carried a page and a WebSocket,
  and the address answered about a minute after it was printed. With `~/.cloudflared/config.yml` present it
  took that file's ingress rules and the address answered 404; with `--config` naming an empty file it served
  the URL. Behind a proxy that blocked QUIC it logged `failed to dial to edge with quic` until given
  `--protocol http2`. (Tried with cloudflared 2026.3.0, 2026-10-10)
- The tailnet address `https://<machine>.<tailnet>.ts.net` is Tailscale's, so no domain is needed.
  (Tailscale docs, Serve, read 2026-10-07)
- `setup --origin` asks for the password again and clears every sign-in; it keeps the passkey relying party
  only when the address is unchanged. The service reads `config.json` when it starts.
  (`apps/server/src/commands/setup.ts`, `apps/server/src/commands/common.ts` `configForSetup`,
  `apps/server/src/commands/serve.ts`)
- Caddy's `reverse_proxy` gets a certificate on its own and passes WebSockets through; nginx needs the
  `Upgrade` and `Connection` headers forwarded. (Caddy docs, reverse_proxy; nginx docs, WebSocket proxying)
- Browsers offer passkeys (WebAuthn) and web push only in a secure context: HTTPS, or `localhost`.
  (W3C WebAuthn and Push API specs)
- The sign-in cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` on an HTTPS origin.
  (`apps/server/src/http/auth/guard.ts` `sessionCookie`)

## Sessions

- Each session is a tmux session on a socket of the service's own; closing the page, locking the phone or
  restarting the service does not end it. (`apps/server/src/system/paths.ts` `tmuxSocketFor`, `apps/server/src/sessions/machine/lifecycle.ts`)
- `workoffdesk attach` joins a session from the Mac's terminal; `workoffdesk claude` and `workoffdesk codex`
  start a Claude or Codex session in the current folder and join it. (`apps/server/src/commands/attach.ts`, `apps/server/src/commands/open.ts`)
- From the phone: start Claude or Codex in a project folder, or pick up a recent Claude or Codex conversation
  from the Mac, read first and taken over on a tap. (`apps/web/src/components/NewSessionSheet.tsx`, e2e `sessions.spec.ts`)
- The project is found by name among the folders used before, or by typing a path (`~/` or `/`), which lists the
  folders in it; only folders inside the Mac user's home are listed, however the path reaches them (`..`, links).
  (`libs/client/src/sessions/projectSearch.ts`, `apps/server/src/system/dirs.ts`, `apps/server/tests/unit/system/dirs.test.ts`)
- Sessions can be renamed; the name is kept on the Mac. (`apps/server/src/system/store.ts`, e2e `sessions.spec.ts`)
- A name given here shows in the list at once, before the Mac answers, and is taken back if the Mac refuses it;
  giving a session the name its agent already has types nothing to it again.
  (`libs/client/src/sessions/rename.ts`, `libs/client/src/sessions/sessionList.ts` `naming`,
  `apps/server/tests/integration/sessions/machine.naming.test.ts`)
- A session is called what it was named here or with Claude Code's `/rename`, whichever came last; else what
  Claude Code (its `ai-title`) or Codex (the thread's name) calls the conversation; else its folder.
  (`apps/server/src/system/store.ts` `shownTitle`, `apps/server/src/journal/ingest.ts` `titleIn`,
  `apps/server/src/sessions/machine/lifecycle.ts` `conversationNamed`)
- A name given here becomes the conversation's name in Claude Code (typed as `/rename` once its prompt is free, or
  given as `--name` when Claude is started) and in Codex (the thread's name). A name is never empty.
  (`apps/server/src/sessions/machine/naming.ts`, `apps/server/tests/integration/sessions/machine.naming.test.ts`,
  `apps/server/tests/integration/sessions/machine.codex.test.ts`)
- When `codex` is installed (in `~/.local/bin` or on `PATH`), a Codex session can be started in a project folder
  too. It runs Codex's own terminal UI against an app server of the service's, which the phone drives; its
  permission requests become cards. Codex's questions are answered at the Mac or with the screen view, and the
  model, effort, `/` list and Rewind are Claude Code's only. (`apps/server/src/http/serve.ts` `resolveCodex`,
  `apps/server/src/agents/codex/`, `docs/design/2026-10-07-codex-sessions.md`)
- A Claude Code conversation open in a terminal on the Mac, outside workoffdesk, can be taken over: Claude quits
  there (SIGTERM, as its own Ctrl-C) and the conversation goes on in a session here. While Claude works or asks
  something on the Mac, it can be taken over once that step is done, or at once. The step is done when its
  transcript says the turn is over, though Claude Code still calls it busy for commands it left running.
  Taken over, it keeps the terminal's environment. (`apps/server/src/sessions/machine/lifecycle.ts` `openOnMac`, `createSession` `takeOver`,
  `apps/server/src/agents/claude/terminals.ts` `openStatus`, `apps/server/src/sessions/terminalEnv.ts`, `docs/design/2026-10-07-take-over-mac-sessions.md`)
- A Codex thread is open where its lock in `~/.codex/thread-writer-locks` is held: a Codex in a terminal on the
  Mac is taken over the same way, without its environment; one held by an editor or the Codex app cannot be.
  (`apps/server/src/agents/codex/threads.ts`, `apps/server/src/sessions/machine/lifecycle.ts` `resumeCodex`,
  `docs/design/2026-10-08-codex-on-the-mac.md`)
- A Claude or Codex session that leaves tmux (ended here, its agent quit, tmux lost it, the Mac restarted) stays in
  the list as past, its conversation readable from the journal, until it is deleted; going on with it brings it back
  as the same session. A shell session is not kept. (`apps/server/src/sessions/machine.ts` `leave`,
  `apps/server/src/sessions/machine/lifecycle.ts` `revive`, `apps/server/tests/integration/sessions/machine.past.test.ts`,
  `docs/design/2026-10-11-session-history.md`)
- Claude Code deletes a transcript at startup once it is older than `cleanupPeriodDays`, 30 days unless set; a past
  session whose transcript is gone is refused going on with (`409 conversation-gone`) and can still be read.
  Codex keeps its rollouts under `~/.codex/sessions/`. (`docs/design/2026-10-11-session-history.md`,
  `apps/server/src/sessions/machine/lifecycle.ts` `conversationGone`)
- **Conversations on the Mac** lists every Claude Code transcript and every Codex thread people opened (`cli`,
  `vscode`) that no session here holds, by day, searched by title, folder or last prompt.
  (`apps/server/src/http/routes/codex.ts`, `libs/client/src/sessions/macHistory.ts`,
  `libs/client/tests/sessions/macHistory.test.ts`, e2e `sessions.spec.ts`)
- When a session's conversation is open in a terminal on the Mac as well, the session says so above the
  composer, since two Claudes would each write it. (`apps/server/src/sessions/machine.ts`, `libs/i18n` `alsoOnMac`)

## Chat

- The phone shows the conversation read from Claude Code's transcript, not a terminal.
  (`apps/server/src/agents/claude/transcript/chat.ts`)
- Questions, permission prompts and multi-select questions become cards; the server reads the screen again
  before pressing anything, and presses nothing if the choices changed. (`apps/server/src/agents/claude/screen/choices.ts`)
- Panels opened by slash commands (`/usage`, `/config`, `/model`…) are shown as a card with a close button.
  (`apps/server/src/agents/claude/screen/panel.ts`)
- Messages sent while Claude works go straight into Claude's own queue; while it starts, asks something,
  compacts or has ended, they wait on the Mac, in order. (`apps/server/src/sessions/outbox.ts`)
- Pictures, videos and other files can be sent from the phone, up to 4 GB each, in 8 MB parts.
  (`apps/server/src/uploads/fileUpload.ts`)
- Uploaded files are deleted after 30 days. (`apps/server/src/uploads/media.ts`)
- Hold to talk uses the browser's own speech recognition; what it hears goes into the message box, and no
  audio is sent to the Mac. (`apps/web/src/voice.ts`, `libs/client/src/composer/talk.ts`)
- Typing `/` lists the slash commands Claude has in that session, read from local files.
  (`apps/server/src/agents/claude/offers/commands.ts`)
- A command typed after `!` shows as that command, and what it printed as a note under it.
  (`apps/server/src/agents/claude/transcript/chat.ts`, `apps/server/tests/unit/agents/claude/transcript/chat.test.ts`)
- The interface is English or Chinese, following the phone. (`libs/i18n`)
- Stop, shown in place of send while Claude works and the composer is empty, sends Esc.
  (`apps/web/src/pages/Session.tsx` `onStop`)
- A bar shows Claude's task list progress; another lists background commands and opens `/tasks`; Read aloud
  uses the browser's `speechSynthesis`; Rewind under the last message sent opens Claude Code's own list of points
  to go back to; Screen shows the Mac's screen as text. (`apps/web/src/components/TaskBar.tsx`,
  `BackgroundBar.tsx`, `turn/Reply.tsx`, `turn/bubbles.tsx`, `libs/i18n` `showScreen`)
- The pill under the composer shows the context used and switches model, permission mode and effort by typing
  the command (`/effort high`). (`apps/web/src/components/KeyMenus.tsx`)
- `@` lists the files of the session's folder. (`libs/client/src/composer/slash.ts` `mentionAt`, `apps/server/src/http/routes/chat.ts`)
- Messages held on the Mac can be edited, moved or dropped; those in Claude's own queue cannot.
  (`apps/web/src/components/QueueTray.tsx`)
- While a panel is open, what is sent stays in the composer. (e2e `chat.spec.ts` panel tests)
- While no Mac terminal is attached, the window is 100×50. (`apps/server/src/sessions/machine.ts` `CHAT_SIZE`)
- Sessions can be renamed by swiping a row left or tapping the title; Save is off while the name is empty.
  The list marks a session Running, Needs you or Unread (`Sessions.tsx` `sess-badge`); SDK-started conversations are folded under
  Sessions of automated tasks; a recent conversation opens read-only until Continue on the phone, or, while
  it is open in a terminal on the Mac, Take over to the phone. (`apps/web/src/pages/Sessions.tsx`, `NewSessionSheet.tsx`, `libs/i18n`)

## Status and notifications

- Claude's state (working, waiting for you, idle) comes from Claude Code hooks, sent over an owner-only Unix
  socket in the service's home. The hooks are passed to each session with `--settings`; your own Claude Code
  settings files are not changed. (`apps/server/src/agents/claude/hooks/hooks.ts`, `apps/server/src/sessions/machine/lifecycle.ts`)
- Web push works from a web app added to the home screen, and notifies when Claude waits for you or finishes a
  turn. (`apps/server/src/notify/push.ts`, `agents/claude/hooks/status.ts` `PushEvent`, `libs/i18n` `pushRemindSub`)
- The iPhone app's notifications need an APNs key of the team that signs the app, named in `apns.json`
  (`teamId`, `keyId`, `keyFile`). A device is tried on Apple's production service, then the sandbox, and kept on
  the one that answered. (`apps/server/src/notify/apns.ts`)
- A notification tapped in the iPhone app opens its session over the session list, closing whatever was open, and
  moves nothing when that session is already in front. (`apps/mobile/src/openSession.ts`,
  `apps/mobile/src/notifications.ts`, `apps/mobile/tests/openSession.test.mjs`)
- Messages waiting on the Mac are kept in `journal.db` (SQLite) in the service's home. (`apps/server/src/journal/`)

## iPhone app

- The native app is built with your own Apple Developer account: `WORKOFFDESK_IOS_BUNDLE_ID` and
  `WORKOFFDESK_TEAM_ID` choose the bundle id and team. (`apps/mobile/app.config.ts`, `apps/mobile/scripts/release-ios.sh`)
- A server built with the same `WORKOFFDESK_IOS_BUNDLE_ID` serves the app's JavaScript updates; built without
  it, it serves none. (`apps/server/scripts/build-app-update.mjs`)

## Logs

- `logs/workoffdesk.log` is the server's log (JSON lines, rotated at 10 MB, 3 kept); `logs/server.log` is what
  launchd catches; `logs/audit.log` records sign-ins; `logs/tunnel.log` is cloudflared's.
  (`apps/server/src/system/log.ts`, `apps/server/src/commands/install.ts`)

## Limitations

- macOS only for the service; one user per install; the iPhone app is built by whoever uses it.
- A Claude Code started in a plain Mac terminal is not a workoffdesk session: it shows under recent
  conversations, to be read and taken over, not driven from the phone while it runs there; so does a Codex.
  Codex threads under another `CODEX_HOME` than the service's are not listed. Only tmux sessions named `wod-…` on the service's socket
  are its sessions. (`apps/server/src/sessions/sessionName.ts`, `apps/web/src/components/NewSessionSheet.tsx`)
