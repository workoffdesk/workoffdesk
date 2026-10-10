# Architecture

A map of the code: the packages, the server's layers, the path a message takes from the phone to Claude and
back, and where to look to change a given thing. What the product does is in
[How it works](guide/how-it-works.md); what each claim rests on is in [facts.md](facts.md).

## Packages

A pnpm workspace: apps in `apps/*`, code they share in `libs/*`.

| Package | What it is | Start at |
|---|---|---|
| `apps/server` | `workoffdesk`, the npm package that runs on the Mac: the CLI, the HTTP server and the sessions. Its build ships the web app in `dist/web`. | `apps/server/src/cli.ts` |
| `apps/web` | `@workoffdesk/web`, the web app phones open (Vite, React, a PWA). | `apps/web/src/main.tsx` |
| `apps/mobile` | `@workoffdesk/mobile`, the iPhone app (Expo, React Native) on the same API. | `apps/mobile/src/app/_layout.tsx` |
| `apps/mac` | The menu bar app (Swift): the service's state and its commands, run through the CLI. | `apps/mac/Sources/WorkOffDeskMenu/App.swift` |
| `libs/client` | `@workoffdesk/client`, what both apps share besides the words, with no UI framework: the API, each session's journal copy, the chat model, formatting. | `libs/client/src/sessions/session.ts` |
| `libs/react` | `@workoffdesk/react`, the React bindings both apps use over `libs/client`. | `libs/react/src/store.ts` |
| `libs/i18n` | `@workoffdesk/i18n`, the words the phone shows, in English and Chinese. | `libs/i18n/src/index.ts` |

## The server's layers

`apps/server/src` is eight layers. A folder imports only from the folders below it, and folders on one line do
not import each other. `pnpm lint` fails on an import that goes the other way (`import/no-restricted-paths` in
`apps/server/eslint.config.js`).

1. `cli.ts`: reads the command and runs it.
2. `commands/`: one file per command: setup and its web wizard, serve, install, start, stop, restart, deploy
   and rollback, status, doctor, attach, claude and codex.
3. `http/`: the Fastify app, its routes (`http/routes/`), sign-in (`http/auth/`) and each session's WebSocket.
4. `sessions/`: `LocalMachine` (`sessions/machine.ts`) and its parts in `sessions/machine/`: starting, taking
   over and ending sessions, what is on screen, each session's status, the Claude accounts. Also the outbox,
   where messages wait.
5. `ops/`: running the service: doctor, releases and deploys, the launchd service, keeping the Mac awake.
6. `journal/`, `notify/`, `uploads/`, `ios-update/`: the journal each device copies a session from (SQLite),
   web push and APNs, files sent from the phone, the iPhone app's updates.
7. `agents/`: Claude Code and Codex, each read and driven on its own terms. `agents/claude/` groups by what of
   Claude Code each part reads: its screen (`screen/`), the conversation file it writes (`transcript/`), what its
   hooks report (`hooks/`), what it offers at its prompt (`offers/`); its accounts, their limits and the Claudes
   open on the Mac are at the top. `agents/codex/` is its app server.
8. `system/`: what every layer uses: tmux, paths, the config, the store, the CLI's words, errors, the log.

## The client's layers

`libs/client/src` is six layers, kept the same way (`libs/client/eslint.config.js`). A module's import path is
its place there: `@workoffdesk/client/sessions/session`.

1. `sessions/`: a session and the list of them.
2. `composer/`: what is typed and sent. `mac/`: the Mac's own pages. `settings/`: the app's own choices.
3. `chat/`: what the chat draws from.
4. `journal/`: each session's journal copy.
5. `model/`: the shapes everything above draws on: the chat item, formatting.
6. `base/`: talking to the server and the platform.

`libs/react` holds the React hooks both apps share over it; what differs by platform is passed in. Drawing (DOM
elements on the web, React Native views on the phone) stays in each app.

## No file over 400 lines

`pnpm lint` fails on a source file over 400 lines, blank lines and comments counted, in every TypeScript package
(`max-lines` in each one's `eslint.config.js`). A file that grows past it splits by what each part does.

## A message, end to end

1. The composer (`apps/web/src/components/Composer.tsx`, `apps/mobile/src/components/Composer.tsx`) calls
   `sendMessage` in `libs/client/src/sessions/session.ts`. The message goes into the session's journal copy and is
   posted (`libs/client/src/journal/journal.ts`) to `POST /api/m/:machine/sessions/:id/messages`, with an id of the
   device's, so one sent again after a lost answer is taken once.
2. The route (`apps/server/src/http/routes/chat.ts`) calls `LocalMachine.sendMessage`
   (`apps/server/src/sessions/machine.ts`), which takes a session's messages one at a time, in order.
3. The outbox (`apps/server/src/sessions/outbox.ts`) delivers it now if Claude can take it. While Claude starts,
   asks something or compacts, it waits in the journal, and goes in once Claude can take it.
4. Delivered, it is pasted into the session's tmux pane and followed by Enter
   (`apps/server/src/sessions/machine/input.ts` `paste`, `apps/server/src/system/tmux.ts`). A Codex session's
   goes as a turn of its thread instead (`apps/server/src/agents/codex/agent.ts` `send`).
5. Claude Code writes the turn to its transcript. A watch on that file
   (`apps/server/src/agents/claude/transcript/watch.ts`, started in `apps/server/src/sessions/machine/status.ts`)
   reads what is new into the journal (`apps/server/src/journal/ingest.ts`, `apps/server/src/journal/index.ts`).
   Hooks report the status as it goes (`apps/server/src/agents/claude/hooks/hooks.ts`).
6. The session's WebSocket (`apps/server/src/http/sessionSocket.ts`) sends each change of the journal to the
   devices looking at the session. The phone adds it to its copy (`libs/client/src/journal/journal.ts`) and draws it.

## Where to change what

| To change | Look in |
|---|---|
| An API route | A file in `apps/server/src/http/routes/` (its `register` is listed in `apps/server/src/http/app.ts`); the apps call it through `libs/client/src/base/api.ts`. |
| What is read off Claude Code's screen | `apps/server/src/agents/claude/screen/screen.ts`, `apps/server/src/agents/claude/screen/choices.ts`, `apps/server/src/agents/claude/screen/panel.ts`, with real captures in `apps/server/tests/fixtures/screens/`. |
| What the chat shows of a transcript | `apps/server/src/agents/claude/transcript/chat.ts` (`chatItems`); the file is read in `apps/server/src/agents/claude/transcript/transcriptFile.ts`. |
| Codex | `apps/server/src/agents/codex/`. |
| A CLI command | A file in `apps/server/src/commands/`, its name in `apps/server/src/cli.ts`, its help line in `apps/server/src/system/messages.ts` (`cli.help`). |
| Words on the phone | `libs/i18n/src/en/` and `libs/i18n/src/zh/`, a file per area of the app; a Chinese area is typed as its English one, so a word missing from either fails `typecheck`. The CLI's words are in `apps/server/src/system/messages.ts`. |
| Notifications | When: `apps/server/src/agents/claude/hooks/status.ts` (`notificationFor`). Sent by `apps/server/src/notify/push.ts` and `apps/server/src/notify/apns.ts`; shown by `apps/web/src/sw.ts` and `apps/mobile/src/notifications.ts`. |

How the code is tested, and which test covers what, is in [testing.md](testing.md).
