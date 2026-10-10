# The apps' and libraries' layout, and the rules that keep it

2026-10-09. The second half of [the server's layout](2026-10-09-server-layout.md): the same rules (folders a
reader can tell layers from, no file over 400 lines, lint keeping both) for `libs/client`, `libs/i18n`,
`libs/react`, `apps/web`, `apps/mobile`, and the two places on the server the first round left flat or long.

## The one rule

**Behaviour does not change.** Every move, rename and split keeps what the code does: the existing tests pass
unchanged in what they assert, their number stays the same, a deploy's smoke test passes, and what the phone
draws is the same, looked at in the simulator. The iPhone app's runtime fingerprint stays `52b8544`: nothing
here changes `apps/mobile/package.json`, its app config or a native dependency.

## `libs/client`, in folders

`@workoffdesk/client` exports `./*` from `./src/*.ts`, so a module's import path is its place in `src/`:
`@workoffdesk/client/session` becomes `@workoffdesk/client/sessions/session`. Every importer in `apps/` and
`libs/react` changes in the same commit as the move. File names stay as they are.

Six layers. A folder imports only from folders below it; folders on one line do not import each other.

1. `sessions/`: a session and the list of them. `session`, `sessionLink`, `sessionList`, `sessionListView`,
   `seen`, `newSession`, `projectSearch`, `macRecent`.
2. `composer/`: what is typed and sent. `composer`, `drafts`, `snippets`, `slash`, `talk`, `hearLocale`,
   `modes`, `keys`, `keyBar`, `hold`.
   `mac/`: the Mac's own pages. `macPage`, `setup`, `usage`.
   `settings/`: the app's own choices. `choices`, `textSize`.
3. `chat/`: what the chat draws from. `chatEntries`, `chatFeed`, `answered`, `markdownBlocks`, `highlight`,
   `images`, `fileUpload`.
4. `journal/`: each session's journal copy. `journal`, `pushes` (they import each other, so they sit together).
5. `model/`: the shapes everything above draws on. `chat` (the `ChatItem`), `format`.
6. `base/`: talking to the server and the platform. `api`, `platform`, `clock`, `retry`, `release`, `listed`,
   `slow`, `login`, `messages`.

Every import today already goes downward in this order; no code changes to make it so. `libs/client`'s eslint
says it the way the server's does (`import/no-restricted-paths` with the TypeScript resolver, the same
`layerZones` helper), so it gains `eslint-plugin-import` and `eslint-import-resolver-typescript` as dev
dependencies, at the server's versions.

Tests move with the code, as on the server: `tests/<name>.test.ts` and its `<name>.<area>.test.ts` go to
`tests/<folder>/`, with their entries on the map in `docs/testing.md`. `tests/helpers/` and `tests/package/` stay.

## No file over 400 lines

`max-lines` 400 (blank lines and comments counted, as on the server) for the source of every package:
`apps/web/src`, `apps/mobile/src`, `libs/client/src`, `libs/i18n/src`, `libs/react/src`. The files over it
split by what each part does. A split keeps every export where its importers find it, or changes the importers
in the same commit; tests of a moved export move with it, their assertions unchanged.

| File | Lines | Splits into |
|---|---|---|
| `libs/client/src/session.ts` | 494 | `sessionState.ts`: the types and the pure `queueWhy` and `sessionState`. `makeSession` stays. |
| `libs/client/src/journal.ts` | 482 | `journalRows.ts`: the types, constants and the pure `applyRows`, `viewOf`, `queue`, `onShow`. `createJournals` stays. |
| mobile `components/Turn.tsx` | 816 | `turn/media.tsx` (pictures, the viewer, videos, files), `turn/tools.tsx` (tool rows, diffs, output), `turn/bubbles.tsx` (what was sent and the reply), `turn/styles.ts`. `TurnView`, `ToolsRow`, `Note` stay in `Turn.tsx`. |
| mobile `components/Composer.tsx` | 684 | Its state and handlers go to hooks in `composer/` (attachments, voice, sending); `VoicePanel` and `Wave` to `composer/VoicePanel.tsx`; styles to `composer/styles.ts`. `Composer` stays, drawing. |
| mobile `app/session/[id].tsx` | 598 | Every file in `app/` is a route to expo-router, so the parts go to `components/session/`: the screen's state and handlers as hooks, its header and sheets as components. The route keeps `SessionScreen`, drawing. |
| mobile `components/Cards.tsx` | 526 | `cards/`, one file per card (`ChoiceCard` with `Picker`, `AskCard`, `PermissionCard`, `TickCard`, `PanelCard`), `cards/bars.tsx` and `cards/styles.ts`, as the web's `components/cards/` already is. `Cards.tsx` goes; its importers name the card's file. |
| mobile `app/settings.tsx` | 404 | Its sections (`Looks`, `ChoiceRow`, `Notify`, `Snippets`) to `components/settings/`. |
| web `components/TurnView.tsx` | 490 | `turn/Reply.tsx`, `turn/media.tsx` (pictures and the viewer), `turn/bubbles.tsx`, `turn/ToolsRow.tsx`. `TurnView` stays. |
| web `pages/Setup.tsx` | 448 | One file per step in `pages/setup/` (`Checks`, `Account`, `Address`, `Service`, `Phone`). `Setup` stays, as the wizard. |
| web `components/Composer.tsx` | 415 | `composer/AttachmentTile.tsx`, `composer/VoicePanel.tsx`. `Composer` stays. |

A hook pulled out of a component keeps its state and effects in the order the component had them, so React
calls them in the same order; what it returns is what the component used.

## The words, by language and by screen

`libs/i18n/src/index.ts` (1156 lines) is two dictionaries and the few lines that pick one. Split by language
alone, each would still be past 400, so each language is a folder, one file per area of the app, as the
dictionary's own section comments already group it:

```
libs/i18n/src/
  index.ts        pickLang, lang, speechLocale, t, dictionaries; Dict = typeof en
  en/index.ts     en = { ...common, ...screen, ...chat, ...composer, ...sessions, ...settings, ...setup }
  en/<area>.ts    one area's words
  zh/index.ts     zh: Dict, the same spread
  zh/<area>.ts    each typed as its English area: `export const chat: typeof en.chat`
```

The areas: `common` (times, statuses, common words, server errors, chat notes, push), `screen` (panels, choice
cards, permission prompts), `chat` (chat view, turns, bars, key menus, sheets), `composer`, `sessions` (session
page, read-only and taken-over conversations, the list, login, the iPhone app's address), `settings` (settings
and this Mac), `setup`. A Chinese area missing a word, or with one the English does not have, fails typecheck in
that area's file, closer to the mistake than `Dict` is today. `@workoffdesk/i18n` is imported only as the
package root, so no importer changes.

## The server's Claude Code agent, in folders

`apps/server/src/agents/claude/` is 22 files in one folder. They group by what of Claude Code each reads:

- `screen/`: what is on its screen. `screen`, `choices`, `panel`, `prompt`, `live`, `compacting`.
- `transcript/`: the conversation file it writes. `chat`, `transcriptFile`, `transcripts`, `watch`, `turn`.
- `hooks/`: what its hooks report. `hooks`, `status`, `asks`, `tracker`.
- `offers/`: what it offers at its prompt, asked of it or read from its files. `initialize`, `commands`,
  `models`, `files`.
- At the top: `accounts`, `usage` (the accounts and their limits), `terminals` (the Claudes open on the Mac).

There is no layer rule inside `agents/claude/`: `transcript/chat` names a hook's own command line
(`hooks/isOwnHookCommand`) and `hooks/asks` names a tool's summary (`transcript/chat`), so the two read each
other, and neither is the other's base. Tests move with the code, as above.

## Long tests split by area

`apps/server/tests/integration/sessions/machine.test.ts` (818 lines) and `libs/client/tests/journal.test.ts`
(736) split by area, as `<module>.<area>.test.ts`, one file per group of `describe` blocks, each with the
setup it uses. Their tests and assertions do not change; the map in `docs/testing.md` names each new file.

## The web and the phone, the same code once

jscpd (`--min-lines 5`) finds 28 copies between `apps/web` and `apps/mobile`, about 330 lines. Most are not
drawing: a card's answer hook (`useAnswer`), the clock hook (`useNow`), how the screen sheet reads and is
pushed the screen, how a Mac conversation finds itself among the recent ones and polls while it is on the
Mac, the props a card, a sheet or the session pill takes. Each such copy goes once to the shared package its
kind belongs in: a React hook to `libs/react` (React and nothing of the DOM or React Native; what differs by
platform, such as whether the app is in front, is passed in), a type or a pure function to `libs/client`, in
the folder its layer puts it in. Drawing (DOM elements on the web, React Native views on the phone) stays in
each app. After this round, every copy jscpd still finds between the apps is drawing, and the plan lists them.

## Docs

`docs/architecture.md` gains `libs/client`'s layers beside the server's, names the moved files where they
now are, and says `max-lines` holds for every package. `docs/testing.md`'s map follows every moved test.
`CONTRIBUTING.md` and the guides name the moved paths. `pnpm check:docs` fails on a path that is not there, so
it finds any left.

## Order

One stage per commit group, each checked, deployed and smoke-tested before the next:

1. `libs/client`: folders, the importers, its tests (with `journal.test.ts` split), `session.ts` and
   `journal.ts` split, the layer rule and `max-lines`.
2. `libs/i18n` by language and area, `libs/react`'s `max-lines`.
3. `apps/web` and `apps/mobile`: the copies to `libs/react` and `libs/client`, both apps moved onto them
   together, the phone looked at in the simulator.
4. `apps/web`: its splits, `max-lines`.
5. `apps/mobile`: its splits, `max-lines`, looked at in the simulator.
6. `apps/server`: `agents/claude/` in folders, `machine.test.ts` split.
7. Docs.

## Checks

At each stage: `typecheck`, `lint` and `build` for the packages touched; `pnpm check:docs`; the number of
tests each touched package's runner lists, the same before and after; the tests of the moved or split modules,
one worker at a time at low priority (the Mac runs the live service); the release build printing runtime
`52b8544`; then deploy and its smoke test. For the phone, the screens whose files split (a session with
pictures, tool rows and a diff, the composer with an attachment and the voice panel, every card, settings) are
looked at in the simulator against the live build before the change.
