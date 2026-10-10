# The server's layout, and the rules that keep it

2026-10-09. Before the repository goes public, the server's source is laid out so that a reader can tell its
layers from its folders, and every file does one thing. Lint keeps it that way.

## The one rule

**Behaviour does not change.** Every move, rename and split keeps what the code does: the existing tests pass
unchanged in what they assert, a deploy's smoke test passes, and the paths a build is known by stay.

## Paths that stay

These are known outside the source and do not move:

- `dist/server/cli.js`: the package's `bin`, the launchd agent `install` writes, `~/.local/bin/workoffdesk`,
  what `release.ts` takes as the mark of a build, and what a rollback to an older release runs. So
  `src/cli.ts` stays where it is, as the entry; what each command does moves to `src/commands/`.
- `bundlePatch.worker.ts` beside `bundlePatch.ts`: the worker is loaded by a URL relative to it.
- The build scripts import `dist/server/{appUpdate,build,paths,tmux}.js`; they change to the new paths in the
  same commit as the move.
- `version.ts` finds `package.json` by walking up from itself to the first one named `workoffdesk`, so its
  depth in `src/` or `dist/server/` no longer matters.

## Layout

```
apps/server/src/
  cli.ts        the entry: parses the command and runs it
  commands/     setup, install, start/stop/restart, deploy/rollback, attach, claude/codex, the setup wizard, qr
  http/         app, serve, routes/, auth/, sessionSocket (was session-ws)
  sessions/     machine (LocalMachine) and machine/ (its parts), outbox, events, panes, terminalEnv, control, sessionName
  ops/          doctor, release, build, report, service, lastOp, awake, shutdown
  journal/      as now
  notify/       apns, push
  uploads/      fileUpload, media
  ios-update/   appUpdate, bundlePatch, bundlePatch.worker
  agents/       claude/, codex/, types (as now)
  system/       tmux, paths, dirs, config, store, messages, errors, log, version, node (MIN_NODE), types/
```

## Tests move with the code

The tests are laid out as `docs/testing.md` says: `src/<path>.ts` is tested in
`tests/{unit,integration}/<path>.test.ts`, and one area of it in `<path>.<area>.test.ts`. `scripts/check-tests.mjs`
fails on a test file whose `src/<path>` is not there, and `scripts/check-docs.mjs` on a test file missing from the
map in `docs/testing.md` or a map entry that is not a file; both run in `pnpm check:docs`. So:

- A move carries the file's tests, `<path>.test.ts` and every `<path>.<area>.test.ts`, to the new path, and their
  entries on the map, in the same commit. `pnpm check:docs` passes at every commit.
- A test that moves deeper or shallower keeps reaching what it reads by path: its imports, `vi.mock`, and the
  paths it builds from `__dirname` or `import.meta.url` (fixtures, `package.json`, `src/cli.ts`).
- When a split moves an export to a new file, the tests of that export (its `describe('<export>')`) move to the
  new file's test, their assertions unchanged. A test that drives a module through its entry stays with the entry:
  `cli.test.ts` runs the CLI, the machine's tests drive `LocalMachine`.
- `tests/helpers/` and `tests/fixtures/` do not move; what changes in them is the paths they import from `src/`.

File names are camelCase, as most already are: `session-ws.ts` becomes `http/sessionSocket.ts`.

## Layers

A folder imports only from folders below it; folders on one line do not import each other.

1. `cli.ts`
2. `commands/`
3. `http/`
4. `sessions/`
5. `ops/`
6. `journal/`, `notify/`, `uploads/`, `ios-update/`
7. `agents/`
8. `system/`

`eslint.config.js` says this with `import/no-restricted-paths` (eslint-plugin-import, with the TypeScript
resolver), one zone per pair of folders that may not import each other. It judges the file an import resolves to,
not the import's text, so `agents/claude/commands.ts` is not taken for `commands/`. A wrong import fails
`pnpm lint` with the rule's message. `max-lines` is 400 for `apps/server/src`.

The imports that go the wrong way today, and where each goes:

| Import | Resolution |
|---|---|
| `agents/claude/status.ts`, `agents/codex/agent.ts`, `journal/index.ts` → `machine.ts` (`ClaudeStatus`) | `ClaudeStatus` moves to `agents/types.ts` |
| `agents/claude/tracker.ts` → `machine.ts` (`LocalMachine`) | the tracker takes a narrow interface it declares; `LocalMachine` meets it |
| `agents/codex/agent.ts` → `journal/` (`Journal`) | the agent declares the narrow interface it writes to; `Journal` meets it |
| `machine.ts`, `config.ts`, `release.ts`, `routes/mac.ts` → `messages.ts`; `machine.ts`, `fileUpload.ts`, `routes/mac.ts` → `errors.ts` | both move to `system/` |
| `agents/claude/accounts.ts`, `machine.ts`, `doctor.ts` → `store.ts` | `store.ts` moves to `system/` |
| `ops/report.ts` → `doctor.ts` | `doctor.ts` moves to `ops/` |
| `doctor.ts` → `install.ts` (`MIN_NODE`, `nodeTooOld`) | both move to `system/node.ts` |
| `messages.ts` → `ops/build.ts` (`BuildStamp`) | `builtFrom` takes the two fields it prints |
| `store.ts` → `agents/claude/usage.ts` (`Limit`) | `Limit` is the shape the store keeps, so it is declared in `store.ts` |

## LocalMachine, split

`LocalMachine` (about 980 of `machine.ts`'s 1180 lines) stays the one class that implements `Machine`, in
`sessions/machine.ts`, so the routes and their tests do not change; its tests stay `sessions/machine.test.ts` and
`sessions/machine.<area>.test.ts`, as they test it through its methods. It keeps the wiring, the session map,
`listSessions`, `onChange`/`watch` and the delegating methods. The work goes to parts in `sessions/machine/`,
beside it, each a class built with the shared session state and the dependencies it uses:

- `lifecycle.ts`: create, continue and resume (Claude and Codex), start, restart, kill, rename, take over, open
  on the Mac.
- `input.ts`: what is on the screen and acting on it: choices, answers, keys, typing, commands, paste, waiting
  for the screen, fitting the pane for the chat.
- `status.ts`: following each agent: its status, turns, compacting, quitting, transcripts, usage.
- `accounts.ts`: the Claude account in use, the accounts view, picking one, each account's last limits.
- `types.ts`: the exported types (`OnScreen`, `CreateSpec`, `ConversationResume`, `TermSession` and the rest `machine.ts` exports).

A part calls another only through methods the plan names. No file in `sessions/machine/` passes 400 lines.

The other server files over 400 lines split the same way, by what each part does: `cli.ts` (to `commands/`),
`agents/codex/agent.ts`, `agents/claude/chat.ts`.

## The web and the phone

`agentName.ts` (a React context) and `store.ts` (the `useStore` and `useSession` hooks) are the same in
`apps/web/src` and `apps/mobile/src`, but for where `sessions` comes from. `libs/client` holds no React, so they
go to a new package, `libs/react` (`@workoffdesk/react`, React as a peer dependency): `agentName.ts` as is, and
`sessionHooks(sessions)`, which returns `useSession` bound to the app's sessions, beside `useStore`. Each app
keeps a two-line `store.ts` that binds its own `sessions`.

The two `chatStore.ts` stay where they are. They are not copies: each is the app's own `ChatStore` (from
`libs/client/src/chatFeed.ts`) over its own storage, IndexedDB on the web and SQLite on the phone, and how
each waits on and orders its reads and writes is fitted to that storage.

The phone's native runtime is unchanged by the new package: the fingerprint the iPhone app's updates are
matched by is the same before and after.

## Docs

- `docs/architecture.md`: the map of the code. The layers, what each package does, how a message goes from
  the phone to the Claude in tmux and back, and where to look to change a given thing.
- `docs/design/README.md`: says the notes are design records from when each change was made, and lists them.
- `CONTRIBUTING.md` points at `docs/architecture.md` in its layout section.

## Order

1. Builds on the test layout of `docs/testing.md` and its checks (on main since fef4bd5), so it starts from
   tests that already mirror `src/`.
2. One stage per commit group, each deployed and smoke-tested before the next: moves and the layer rule;
   `LocalMachine` split; the other large server files; the web/phone shared code; docs.

## Checks

At each stage: `typecheck`, `lint` and `build` for the packages touched; `pnpm check:docs`; the number of tests
`vitest list` finds, the same before and after; the tests of the moved or split modules, run one worker at a time at low priority (the Mac runs the live service); then deploy and its smoke
test.

## Not in this round

- `libs/client/src` is 43 files in one folder, and `apps/web`/`apps/mobile`/`libs/client` have files over 400
  lines (the phone's `Turn.tsx`, `Composer.tsx`, the session page; the web's `TurnView.tsx`; the client's
  `session.ts`, `journal.ts`). The layer rule and `max-lines` are set for the server only this round.
- `libs/i18n/src/index.ts` (1156 lines) is the strings table; splitting it by language is its own change.
