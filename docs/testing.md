# Testing

WorkOffDesk types into terminals on someone's Mac, from a phone, over lines that drop. A test here is worth
writing when it guards something that would hurt if it broke: a stranger getting in, a message lost or sent
twice, a key landing in the wrong program, the phone saying Claude is working when it has stopped. This page
names those risks, says how each is tested, and maps every test file to the risk it guards, so a gap is a risk
with nothing under it rather than a line a coverage report shows red.

How to run the checks, and how a test is kept away from your own home, Claude and files, is in
[CONTRIBUTING](../CONTRIBUTING.md#checks).

## What can go wrong

Each risk is the rule the tests hold the code to, then how they hold it.

### Who gets in

Only a person signed in on this server reaches a session: by password, passkey or the app's token, from the
server's own origin. A route added without a login check fails `auth/guard`, which asks every route Fastify
has, not a list kept by hand. A socket lives only as long as the login that opened it. Passkeys are made and
used end to end with an authenticator in software, including a forged, copied or replayed one.

### What is sent arrives, once

A message, a key, a command or a file sent from the phone reaches the Mac exactly once, in order, through a
dropped line, an answer lost on the way, a restart of the server or of the app. Tests drive each way a request
can end (sent, refused, timed out, lost after the Mac took it) and send it again, and check what the Mac holds.

### Keys reach only what the phone was shown

What is typed goes to the program the phone showed, and only while it still shows it: an answer to a choice
goes in only if the choice is still on screen, nothing is typed into the shell a Claude that quit left behind,
and a request a route refuses reaches no terminal at all. Tests use a real tmux with programs of their own.

### Reading Claude Code and Codex right

The server reads other programs: Claude Code's screen, transcripts and hooks, Codex's app server and rollouts.
Tests read them from what those programs really wrote. Screens under `apps/server/tests/fixtures/screens` are
`tmux capture-pane` output, never hand-written ([Screen fixtures](../CONTRIBUTING.md#screen-fixtures)); a
transcript or rollout shape is copied from a real one. When the other program changes, a new capture is added
and the test that reads it fails first.

### The status says what is true

Working, waiting on the person, compacting, ended: the phone shows what the agent is doing, from its hooks,
its screen and its process, and corrects itself when one of them goes quiet. Tests take each source away in
turn: a hook that never comes, a Claude killed, a server restarted mid-turn.

### The phone keeps up, and comes back

The phone's copy of a session catches up from where it is, by asking and by what the Mac pushes, and keeps
working through a socket that drops, a Mac that restarts and an app that was in the background. Timing is
tested on a fake clock: the same tick, while a request is out, after it is answered, after it fails.

### The Mac and its user's things are left alone

WorkOffDesk stops or takes over only what it started or was asked to, and never another Claude, Codex or
terminal. The same goes for the tests themselves, which run on a Mac someone uses: `isolation` fails if a test
could reach the real home, tests that start processes stop them by their process group, and `machine` fails
when a process it started outlives its tmux.

### Installed, run, updated, rolled back

Installing writes what it says, the service starts and stops under launchd, a build that fails its smoke test
or does not come up healthy leaves the one before running, a rollback goes back, and the iPhone app gets only an
update made for its native build, whole or as a patch.

### What the person reads and touches

The chat, the composer, the lists and the settings read and behave as a person expects, in English and in
Chinese. Most of this is `libs/client`, shared by the web app and the iPhone app; the end-to-end tests drive the
web app in iPhone WebKit.

### The docs say what is true

The README and guides say only what `docs/facts.md` backs, every guide has its Chinese twin, links lead
somewhere, and this map names every test file.

## For every change

Before writing the code, answer these, and turn each answer into a test:

1. **The rule, in one sentence**, saying what must hold and not how ("a page that left the screen does not take
   taps", not "keep the lock after success").
2. **Every way to break it.** Not only the one reported: the empty and the odd input; each kind of failure (a
   refusal, a timeout, a dropped line, an answer that is not what was expected); each moment (the same tick,
   while in flight, after success, after failure, on the way to another screen, coming back, twice at once);
   and what must still be allowed, such as trying again after a failure.
3. **Who already knows.** Use the real thing where it is cheap and safe (tmux, the file system, SQLite, a local
   HTTP/2 server) and fake only what is not: a person's account, Apple, a model that costs tokens.
4. **Watch it fail first**, for the reason you expect, then make it pass. For code already written, undo each
   condition the test is for and watch the test fail.

Title a test with what a person sees. Assert the kind of thing, and list the cases with `it.each`.

## Writing a test

**Where it goes.** A test file mirrors what it tests, so a module's tests are found without searching.

- `apps/server/tests/unit/<path>.test.ts` and `apps/server/tests/integration/<path>.test.ts` test
  `apps/server/src/<path>.ts`; `libs/client/tests/<path>.test.ts` tests `libs/client/src/<path>.ts`, and so
  on.
- One area of a large module is `<module>.<area>.test.ts` (`machine.status.test.ts`). The whole server on a
  real tmux is `app.<area>.test.ts`; one module of routes, against a machine made for the test, is
  `routes/<module>.test.ts`.
- A file of the package or the repository keeps its whole name: `scripts/<name>.test.ts`,
  `app.config.test.mjs`, `install.sh.test.ts`. What holds for the whole package goes in `package/`.
- End-to-end specs are named by flow: `apps/server/tests/e2e/<flow>.spec.ts`.
- `tests/helpers/` holds the code tests import: signing in, a tmux of the test's own, a `LocalMachine` on a
  fake claude, `until`.
  `tests/fixtures/` holds the files tests read or run as a process of their own: screens, fake programs.

**How it is named.** A `describe` names what is tested: the export (`describe('createStore')`), the route
(`describe('POST /api/uploads/parts/:id')`), the command or the script. Conditions nest as
`describe('when …')` or `describe('with …')`. A title starts with what the code does, in the third person:
`it('retries with backoff on a 503')`, never "should". Many cases are one `it.each`, with `%s` or `$name` in
the title. End to end, `test.describe('<screen>')` holds `test('<does> …')`. Swift keeps XCTest's
`test<Does>…`.

**How it is written.** One behaviour to a test; arrange, act and assert apart, with blank lines once it runs
past a few. Setup shared by a file's tests goes in `beforeEach` or a `setup()` that returns what a test needs,
and setup shared by files goes in `tests/helpers/`. Time runs on a fake clock. A test waits for what it
expects with `vi.waitFor`, `expect.poll` or `until`; a fixed wait only shows that something does not come.

`node scripts/check-tests.mjs`, part of `pnpm check:docs` and CI, fails on a test file that tests nothing
there is, a test among the helpers or fixtures, and a title that starts with "should".

## The kinds of test

| Kind | Where | Good for | Runs in |
|---|---|---|---|
| Unit | `apps/*/tests/unit`, `apps/mobile/tests`, `libs/*/tests` | rules and timing, on a fake clock | `pnpm check` |
| Integration | `apps/server/tests/integration` | the server with real tmux, files, processes and sockets | `pnpm check` |
| End to end | `apps/server/tests/e2e` | the web app in iPhone WebKit against a real server | `test:e2e`, not CI yet |
| Package | `test:pack` | the npm package installs and serves | CI |
| Menu bar app | `apps/mac/Tests` | the Mac app's reading of the CLI | CI (`swift test`) |
| Docs | `scripts/check-docs.test.mjs`, `scripts/check-tests.test.mjs` | the docs and test checks themselves | `pnpm check` |

## The map

Every test file is listed under the risks it guards; one that guards several is listed under each.
`node scripts/check-docs.mjs` fails on a test file missing here, so a new test comes with its place on the map.

### Who gets in

- Server: `apps/server/tests/unit/http/auth/password.test.ts`, `apps/server/tests/unit/http/auth/lockout.test.ts`,
  `apps/server/tests/unit/http/auth/sessions.test.ts`, `apps/server/tests/integration/http/routes/auth.test.ts`,
  `apps/server/tests/integration/http/auth/passkey.test.ts`,
  `apps/server/tests/integration/http/auth/passkey.ceremony.test.ts`,
  `apps/server/tests/integration/http/auth/lockout.test.ts`, `apps/server/tests/integration/http/auth/guard.test.ts`,
  `apps/server/tests/integration/http/app.auth.test.ts`
- Client: `libs/client/tests/base/login.test.ts`, `libs/client/tests/mac/setup.test.ts`
- End to end: `apps/server/tests/e2e/login.spec.ts`, `apps/server/tests/e2e/settings.spec.ts`

### What is sent arrives, once

- Server: `apps/server/tests/unit/sessions/outbox.test.ts`, `apps/server/tests/unit/journal/index.test.ts`,
  `apps/server/tests/unit/journal/db.test.ts`, `apps/server/tests/unit/journal/derive.test.ts`,
  `apps/server/tests/unit/uploads/fileUpload.test.ts`, `apps/server/tests/unit/uploads/media.test.ts`,
  `apps/server/tests/unit/agents/claude/hooks/tracker.test.ts`, `apps/server/tests/integration/http/routes/chat.test.ts`,
  `apps/server/tests/integration/http/routes/media.test.ts`,
  `apps/server/tests/integration/http/routes/journal.test.ts`,
  `apps/server/tests/integration/http/app.sessions.test.ts`, `apps/server/tests/integration/http/app.media.test.ts`,
  `apps/server/tests/integration/sessions/machine.sending.test.ts`, `apps/server/tests/integration/sessions/machine.moves.test.ts`
- Client: `libs/client/tests/journal/journal.sending.test.ts`, `libs/client/tests/journal/journalRows.test.ts`,
  `libs/client/tests/package/storage.test.ts`, `libs/client/tests/base/messages.test.ts`, `libs/client/tests/sessions/session.test.ts`,
  `libs/client/tests/composer/composer.test.ts`, `libs/client/tests/chat/fileUpload.test.ts`,
  `libs/client/tests/base/api.test.ts`, `libs/client/tests/base/retry.test.ts`
- End to end: `apps/server/tests/e2e/connection.spec.ts`, `apps/server/tests/e2e/queue.spec.ts`,
  `apps/server/tests/e2e/composer.spec.ts`, `apps/server/tests/e2e/pictures.spec.ts`

### Keys reach only what the phone was shown

- Server: `apps/server/tests/unit/agents/claude/screen/screen.test.ts`,
  `apps/server/tests/unit/agents/claude/screen/choices.test.ts`, `apps/server/tests/integration/http/routes/chat.test.ts`,
  `apps/server/tests/integration/sessions/machine.test.ts`, `apps/server/tests/integration/system/tmux.test.ts`,
  `apps/server/tests/integration/sessions/control.test.ts`, `apps/server/tests/integration/sessions/machine.sending.test.ts`,
  `apps/server/tests/integration/sessions/machine.naming.test.ts`, `apps/server/tests/unit/agents/claude/screen/prompt.test.ts`
- Client: `libs/client/tests/composer/modes.test.ts`, `libs/client/tests/sessions/session.test.ts`,
  `libs/client/tests/composer/hold.test.ts`, `libs/client/tests/composer/keys.test.ts`
- End to end: `apps/server/tests/e2e/composer.spec.ts`, `apps/server/tests/e2e/chat.spec.ts`

### Reading Claude Code and Codex right

- Claude Code's screen: `apps/server/tests/unit/agents/claude/screen/choices.test.ts`,
  `apps/server/tests/unit/agents/claude/screen/panel.test.ts`, `apps/server/tests/unit/agents/claude/screen/live.test.ts`,
  `apps/server/tests/unit/agents/claude/screen/compacting.test.ts`, `apps/server/tests/unit/agents/claude/screen/prompt.test.ts`
- Claude Code's files and answers: `apps/server/tests/unit/agents/claude/transcript/chat.test.ts`,
  `apps/server/tests/unit/agents/claude/transcript/events.test.ts`,
  `apps/server/tests/unit/agents/claude/transcript/transcriptFile.test.ts`,
  `apps/server/tests/unit/agents/claude/transcript/transcripts.test.ts`,
  `apps/server/tests/unit/agents/claude/transcript/turn.test.ts`, `apps/server/tests/unit/agents/claude/usage.test.ts`,
  `apps/server/tests/unit/agents/claude/offers/commands.test.ts`,
  `apps/server/tests/unit/agents/claude/accounts.test.ts`,
  `apps/server/tests/integration/agents/claude/offers/initialize.test.ts`,
  `apps/server/tests/integration/agents/claude/offers/models.test.ts`,
  `apps/server/tests/integration/agents/claude/offers/files.test.ts`,
  `apps/server/tests/integration/agents/claude/transcript/watch.test.ts`
- Codex: `apps/server/tests/unit/agents/codex/events.test.ts`, `apps/server/tests/unit/agents/codex/items.test.ts`,
  `apps/server/tests/unit/agents/codex/threads.test.ts`,
  `apps/server/tests/integration/agents/codex/rpc.test.ts`,
  `apps/server/tests/integration/agents/codex/agent.test.ts`,
  `apps/server/tests/integration/agents/codex/threads.test.ts`,
  `apps/server/tests/integration/agents/codex/appServer.test.ts`
- The phone's speech recognizers: `libs/client/tests/composer/hearLocale.test.ts`, `libs/client/tests/composer/talk.test.ts`

### The status says what is true

- Server: `apps/server/tests/unit/agents/claude/hooks/status.test.ts`,
  `apps/server/tests/unit/agents/claude/hooks/tracker.test.ts`, `apps/server/tests/unit/sessions/machine.status.test.ts`,
  `apps/server/tests/unit/agents/claude/hooks/tracker.compaction.test.ts`,
  `apps/server/tests/unit/agents/claude/hooks/asks.test.ts`, `apps/server/tests/unit/sessions/machine.watch.test.ts`,
  `apps/server/tests/unit/sessions/events.test.ts`, `apps/server/tests/integration/agents/claude/hooks/hooks.test.ts`,
  `apps/server/tests/integration/sessions/machine.test.ts`, `apps/server/tests/integration/sessions/machine.quit.test.ts`,
  `apps/server/tests/integration/sessions/machine.moves.test.ts`, `apps/server/tests/unit/sessions/machine.working.test.ts`,
  `apps/server/tests/integration/commands/activity.test.ts`
- Client: `libs/client/tests/sessions/sessionState.test.ts`, `libs/client/tests/sessions/sessionLink.test.ts`,
  `libs/client/tests/model/chat.test.ts`

### The phone keeps up, and comes back

- Server: `apps/server/tests/unit/http/sessionSocket.test.ts`, `apps/server/tests/unit/journal/index.test.ts`,
  `apps/server/tests/unit/journal/db.test.ts`, `apps/server/tests/unit/journal/derive.test.ts`,
  `apps/server/tests/integration/http/app.test.ts`, `apps/server/tests/integration/http/app.claude.test.ts`,
  `apps/server/tests/integration/http/routes/journal.test.ts`, `apps/server/tests/unit/http/routes/claude.test.ts`
- Client: `libs/client/tests/journal/journal.test.ts`, `libs/client/tests/sessions/sessionList.test.ts`,
  `libs/client/tests/journal/pushes.test.ts`, `libs/client/tests/sessions/sessionLink.test.ts`,
  `libs/client/tests/chat/chatFeed.test.ts`, `libs/client/tests/model/chat.test.ts`,
  `libs/client/tests/sessions/macRecent.test.ts`, `libs/client/tests/base/release.test.ts`,
  `libs/client/tests/base/platform.test.ts`, `libs/client/tests/base/retry.test.ts`,
  `libs/client/tests/base/api.test.ts`
- End to end: `apps/server/tests/e2e/connection.spec.ts`, `apps/server/tests/e2e/chat.spec.ts`

### The Mac and its user's things are left alone

- The tests themselves: `apps/server/tests/unit/package/isolation.test.ts`
- Server: `apps/server/tests/integration/agents/claude/terminals.test.ts`, `apps/server/tests/integration/sessions/machine.onMac.test.ts`,
  `apps/server/tests/integration/sessions/machine.codex.test.ts`,
  `apps/server/tests/integration/http/routes/claude.test.ts`, `apps/server/tests/integration/http/routes/codex.test.ts`,
  `apps/server/tests/integration/sessions/terminalEnv.test.ts`, `apps/server/tests/unit/agents/codex/threads.test.ts`,
  `apps/server/tests/unit/sessions/panes.test.ts`, `apps/server/tests/unit/system/store.test.ts`,
  `apps/server/tests/unit/ops/awake.test.ts`, `apps/server/tests/unit/ops/shutdown.test.ts`,
  `apps/server/tests/integration/sessions/machine.test.ts`, `apps/server/tests/integration/sessions/machine.quit.test.ts`
- Client: `libs/client/tests/sessions/newSession.test.ts`, `libs/client/tests/sessions/moveAccount.test.ts`,
  `libs/client/tests/sessions/quitOnMac.test.ts`

### Installed, run, updated, rolled back

- Installing and running: `apps/server/tests/unit/commands/install.test.ts`, `apps/server/tests/unit/commands/account.test.ts`, `apps/server/tests/unit/system/node.test.ts`,
  `apps/server/tests/integration/install.sh.test.ts`, `apps/server/tests/unit/cli.test.ts`,
  `apps/server/tests/unit/http/serve.test.ts`, `apps/server/tests/unit/ops/service.test.ts`,
  `apps/server/tests/unit/system/config.test.ts`, `apps/server/tests/unit/ops/doctor.test.ts`,
  `apps/server/tests/integration/commands/wizard/server.test.ts`, `apps/server/tests/unit/commands/wizard/probe.test.ts`,
  `apps/server/tests/unit/commands/qr.test.ts`, `apps/server/tests/unit/system/log.test.ts`,
  `apps/server/tests/unit/ops/problems.test.ts`, `apps/server/tests/integration/http/routes/health.test.ts`,
  `libs/client/tests/base/slow.test.ts`
- Deploying and rolling back: `apps/server/tests/integration/ops/release.test.ts`,
  `apps/server/tests/unit/ops/build.test.ts`, `apps/server/tests/unit/package/scripts.test.ts`,
  `apps/server/tests/unit/ops/lastOp.test.ts`, `apps/server/tests/integration/http/routes/mac.test.ts`,
  `apps/server/tests/unit/package/publish.test.ts`
- The iPhone app's updates: `apps/server/tests/integration/http/routes/appUpdate.test.ts`,
  `apps/server/tests/unit/ios-update/appUpdate.test.ts`, `apps/server/tests/unit/scripts/build-app-update.test.ts`,
  `apps/server/tests/unit/ios-update/bundlePatch.test.ts`, `apps/mobile/tests/app.config.test.mjs`
- Push notifications: `apps/server/tests/unit/notify/apns.test.ts`, `apps/server/tests/unit/notify/push.test.ts`,
  `apps/server/tests/integration/http/app.push.test.ts`, `apps/mobile/tests/openSession.test.mjs`
- The This Mac page and the menu bar app: `libs/client/tests/mac/macPage.test.ts`,
  `apps/mac/Tests/WorkOffDeskKitTests/CLITests.swift`, `apps/mac/Tests/WorkOffDeskKitTests/StatusTests.swift`,
  `apps/mac/Tests/WorkOffDeskKitTests/QRTests.swift`, `apps/mac/Tests/WorkOffDeskKitTests/AccountsTests.swift`,
  `apps/mac/Tests/WorkOffDeskKitTests/ActivityWatchTests.swift`, `apps/mac/Tests/WorkOffDeskUITests/MenuBarMarkTests.swift`

### What the person reads and touches

- The chat: `libs/client/tests/model/chat.cards.test.ts`, `libs/client/tests/chat/chatEntries.test.ts`,
  `libs/client/tests/model/chat.test.ts`, `libs/client/tests/chat/markdownBlocks.test.ts`,
  `libs/client/tests/chat/markdownBlocks.test.ts`, `libs/client/tests/chat/highlight.test.ts`,
  `libs/client/tests/chat/images.test.ts`, `libs/client/tests/chat/images.test.ts`, `libs/client/tests/mac/usage.test.ts`,
  `apps/mobile/tests/swipeAway.test.mjs`
- The composer: `libs/client/tests/composer/composer.test.ts`, `libs/client/tests/composer/slash.test.ts`,
  `libs/client/tests/composer/snippets.test.ts`, `libs/client/tests/composer/talk.test.ts`,
  `libs/client/tests/composer/keyBar.test.ts`
- Lists and new sessions: `libs/client/tests/sessions/sessionListView.test.ts`, `libs/client/tests/sessions/rowSwipe.test.ts`, `libs/client/tests/base/listed.test.ts`,
  `libs/client/tests/sessions/seen.test.ts`, `libs/client/tests/sessions/newSession.test.ts`,
  `libs/client/tests/sessions/projectSearch.test.ts`, `apps/server/tests/unit/system/dirs.test.ts`, `apps/server/tests/unit/system/project.test.ts`,
  `apps/server/tests/unit/package/name.test.ts`, `apps/server/tests/unit/sessions/sessionName.test.ts`,
  `libs/client/tests/sessions/leave.test.ts`, `libs/client/tests/sessions/rename.test.ts`,
  `libs/client/tests/sessions/macHistory.test.ts`,
  `apps/server/tests/integration/sessions/machine.past.test.ts`
- Words, errors and settings: `libs/client/tests/model/format.test.ts`, `libs/client/tests/base/api.test.ts`,
  `libs/client/tests/settings/textSize.test.ts`, `libs/client/tests/settings/choices.test.ts`, `libs/client/tests/base/api.test.ts`,
  `libs/i18n/tests/index.test.ts`, `apps/server/tests/unit/system/messages.test.ts`,
  `apps/server/tests/unit/system/errors.test.ts`, `apps/web/tests/unit/styles.css.test.ts`, `apps/mobile/tests/theme.test.mjs`,
  `apps/mac/Tests/WorkOffDeskKitTests/WordsTests.swift`,
  `apps/mac/Tests/WorkOffDeskUITests/MenuViewTests.swift`
- End to end: `apps/server/tests/e2e/chat.spec.ts`, `apps/server/tests/e2e/composer.spec.ts`,
  `apps/server/tests/e2e/layout.spec.ts`, `apps/server/tests/e2e/pictures.spec.ts`,
  `apps/server/tests/e2e/sessions.spec.ts`, `apps/server/tests/e2e/settings.spec.ts`,
  `apps/server/tests/e2e/speech.spec.ts`, `apps/server/tests/e2e/screens.spec.ts`

### The docs say what is true

`scripts/check-docs.test.mjs`, `scripts/check-tests.test.mjs`, `apps/server/tests/unit/scripts/npm-docs.test.ts`,
`apps/server/tests/unit/scripts/changelog-section.test.ts`

## Known gaps

- **The end-to-end tests do not run in CI**, and some do not pass since messages were queued differently. They
  are the only tests that send a message from a browser through a dropped line or a restart of the Mac side
  and check that it arrives once, so that risk is guarded below the browser only until they run again.
- **The iPhone app's own screens have no tests.** Its logic is in `libs/client`; what it draws is checked by
  hand in the simulator. The web app's components have none of their own either; the end-to-end tests drive
  them.
- **Fixtures age.** A captured screen shows the Claude Code that drew it; the tests keep the server reading
  those captures, not the Claude Code installed today. A change in Claude Code shows up only once someone
  captures the new screen.
- **Lengths of time are not pinned.** Polling intervals, the push service's timeouts and the like are tested
  by what happens around them, not by their exact values, so retuning one needs no test change.
