# Contributing

## Layout

A pnpm workspace: apps in `apps/*`, code shared between apps in `libs/*`.

- `apps/server` — the `workoffdesk` npm package: the server and CLI that run on the Mac (`src/`, tests in
  `tests/`). Its build ships the web app's build in `dist/web`.
- `apps/web` — `@workoffdesk/web`, the web app phones open (Vite, React, a PWA).
- `apps/mobile` — `@workoffdesk/mobile`, the iPhone app (Expo, React Native). See its
  [AGENTS.md](apps/mobile/AGENTS.md) and [docs/guide/ios-app.md](docs/guide/ios-app.md).
- `libs/i18n` — `@workoffdesk/i18n`, the words in English and Chinese, shared by the web app and the iPhone app.
- `libs/client` — `@workoffdesk/client`, what the two apps share besides the words: the API, the chat model,
  formatting.
- `libs/react` — `@workoffdesk/react`, the React hooks the two apps share over `libs/client`.
- `docs/guide` — the user guide, in English and Chinese; `docs/design` — design notes; `docs/facts.md` — what
  the guide may claim, each with its source.

The server's and the client's layers, the 400-line limit on a file, the path a message takes, and where to
change what: [docs/architecture.md](docs/architecture.md).

## From source

You need macOS, Node 22.13 or later, pnpm, tmux 3.3 or later, and Claude Code.

```bash
pnpm install
pnpm build
cd apps/server
WORKOFFDESK_HOME=/tmp/workoffdesk-dev node dist/server/cli.js setup --origin http://localhost:7681
WORKOFFDESK_HOME=/tmp/workoffdesk-dev node dist/server/cli.js serve
WORKOFFDESK_HOME=/tmp/workoffdesk-dev node dist/server/cli.js doctor
pnpm --filter @workoffdesk/web dev   # Vite on its own port; /api goes to WORKOFFDESK_DEV_BACKEND (default 127.0.0.1:7681)
```

Use a throwaway `WORKOFFDESK_HOME` while developing, so nothing touches an install you actually use. For
`http://localhost`, the origin must be `http://localhost:<port>`; sign-in is refused on an origin mismatch.

## Checks

```bash
pnpm check                              # every package: lint, typecheck, tests; and the docs pairs
pnpm --filter workoffdesk test:e2e      # Playwright, iPhone WebKit; starts its own server, tmux and home
pnpm --filter workoffdesk test:pack     # packs, installs the tarball into a temporary prefix, and checks it serves
pnpm --filter workoffdesk screens       # the screenshots in docs/screens, in English and Chinese
pnpm --filter workoffdesk demo          # the README's demo GIFs in docs/screens; needs ffmpeg and Python's Pillow
swift test --package-path apps/mac      # the menu bar app; pnpm check leaves it out
```

Every test runs with `HOME` pointed at a temporary folder (`apps/server/tests/setup-home.ts`), so a test can
never read or write a real `~/.workoffdesk`. Tests that need the real home ask for `TEST_REAL_HOME`
explicitly. The same file leaves out `CLAUDE_CONFIG_DIR` and `CODEX_HOME`, and puts a `claude` first on `PATH`
that lists no one open and runs nothing, so a session a test starts never opens the installed Claude Code with
your account; `TEST_REAL_PATH` finds the real one. Each test file gets a `TMPDIR` of its own too, removed when
its tests end; a Unix socket goes under `/tmp` instead (`apps/server/tests/helpers/socketDir.ts`), since a
socket's path may be at most 104 bytes on macOS. The CLI speaks the Mac's language; `apps/server/tests/setup-lang.ts` sets `LANG=en_US.UTF-8`, so
tests read its English. Two tests start the real `claude` when it is installed. The one that sends it a prompt
spends a few tokens of the signed-in account, so it runs only with `WORKOFFDESK_REAL_CLAUDE=1`.

Some end-to-end tests do not pass yet, after recent changes to how messages are queued, so CI runs
`pnpm check` and not the end-to-end tests.

What to test, and which test guards which risk, is in [Testing](docs/testing.md). A new test file goes on its
map, or `pnpm check:docs` fails; where it goes and how it is named is in
[Writing a test](docs/testing.md#writing-a-test).

## How changes are made

- **Tests first.** Write the test, watch it fail for the right reason, then make it pass. A bug fix comes
  with the test that reproduces it.
- A test for code already written: undo the line it covers, watch the test fail, then put the line back. A
  test that still passes without the line does not test it.
- A `describe` names the code it tests, and each title says what that code does, as a person would see it.
- Keep comments in English and few; prefer a name that needs no comment.
- Commits: `type(scope): summary` (`feat`, `fix`, `refactor`, `docs`, `test`, `build`), one change each.
- **Docs.** The README and `docs/guide/` say only what `docs/facts.md` backs; a pull request that adds a claim
  adds its fact, with the source. Each guide page has an English and a Chinese file with the same headings
  (`pnpm check` compares them). Screenshots in `docs/screens/` come from `tests/e2e/screens.spec.ts` and the demo GIFs from
  `tests/e2e/demo/make.sh`, never by hand.

## Screen fixtures

`apps/server/tests/fixtures/screens/*.txt` are real `tmux capture-pane -p` output from Claude Code, not
hand-written. When Claude Code changes how a question, a panel or the prompt looks, capture the new screen
the same way and add it as a fixture, rather than editing an old one to match.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
