# One client core for the web app and the iPhone app

Status: approved for planning. Paths are under the repository root; line counts are from `d529843`.

## Why

The web app (`apps/web`, React DOM) and the iPhone app (`apps/mobile`, Expo) each implement the session
screen, the composer, the chat list and the session list. `libs/client` holds what they already share. That
is pure functions (`chat.ts`, `slash.ts`, `images.ts`) and stores built from injected platform parts
(`createJournals`, `createSessionLinks`, `createSessionList`). Everything stateful above those stores is
written twice:

| Concern | Web | iPhone |
|---|---|---|
| Session screen: link, send, Ctrl, paste, modes, commands, queue actions, end, models, suggestion | `pages/Session.tsx` (538) | `app/session/[id].tsx` (854) |
| Chat list: which rows, cards and notes show, and when | `components/ChatView.tsx` (384) | `app/session/[id].tsx:427-579` |
| Composer: draft, refill, `/` commands, snippets, `@` files, attachments, send, hold to talk | `components/Composer.tsx` (470) | `components/Composer.tsx` (799) |
| Session list: sort, search, group by folder, unread, the Mac's other conversations | `pages/Sessions.tsx` (222) | `app/index.tsx` (249) |
| Hooks: `useSessionView`, `useSessions`, `useChat`, the working clock | `ChatView.tsx`, `sessions.ts` | `hooks.ts` |

The two copies have already drifted (see "Where the apps differ today"). Every fix has to be made twice and
checked twice, and the UI has almost no tests (web 2, iPhone 1, 20 end-to-end tests red).

**Invariant.** What a session does, what each action sends, and which state it shows are defined once, in
`libs/client`. An app lays that out and passes in its platform's parts; it decides nothing about the session.

**Goals.** A: no behaviour written twice. D: that behaviour is covered by tests that run in Node, so the
UI can change without breaking it.

**Not goals.** No new features apart from the wide-screen layout below. No change to the server or to the
API. No change to how anything looks on a phone apart from the key-bar ruling below. This work does not
replace `apps/web` with React Native Web; the spike below decides that question, and it gets its own spec.

## Design

`libs/client` stays free of React. Both apps use React, but on different versions (web 19.2.0, iPhone
19.2.3), and pnpm would give the library its own copy, which in a bundle is a second React and breaks
hooks. Every new store exposes `subscribe(listener) → unsubscribe` and `getSnapshot()`, the shape
`useSyncExternalStore` takes. Each app adds one binding file of about 30 lines (`useStore`).

### 1. The session (`libs/client/src/session.ts`)

`createSessions(deps)` is created once per app, beside the other stores in `platform.ts` / `client.ts`.
`sessions.get(id)` returns the `Session` for that id, the same one while it is held. `session.hold()`
starts it (the line, the journal, the models) and returns its release. The session stops on a timer of 0
after the last release, so React's StrictMode, which mounts, unmounts and mounts again, keeps the one
session rather than closing it under the screen. Once stopped, `get` makes a new one.

```ts
type SessionDeps = {
  api: Api; journals: Journals; links: SessionLinks; list: SessionList; seen: Seen;
  readClipboard: () => Promise<string>;
};
type Session = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SessionSnapshot;   // the same object until something changes
  hold(): () => void;
  // keys and text on the session's line
  send(data: string): boolean;               // applies an armed Ctrl to the first key
  sendText(text: string, enter: boolean): boolean;
  armCtrl(on: boolean): void;
  paste(): Promise<void>;
  // the composer's message: a panel holds it (nudge), a bare Enter or armed Ctrl is a keystroke,
  // otherwise it goes to the journal, and comes back to the composer if that fails
  sendMessage(text: string): boolean;
  // Claude Code's dialogs and cards: keys go as a request, and the answer brings the next screen
  press(keys: string): boolean;
  closeDialog(): boolean;
  settle(): void;                            // a pick was made: hold the dialog until the next screen
  reread(): void;
  runCommand(command: string): void;         // one at a time, until its dialog shows or 10 s pass
  switchMode(want: string | null): Promise<void>;
  // the queue tray
  sendNow(q: Queued): Promise<boolean>;
  move(q: Queued, by: -1 | 1): Promise<boolean>;
  unsend(q: Queued, edit: boolean): Promise<boolean>;
  giveBack(text: string): void;              // into the composer: bumps `refill`
  dismissSuggestion(): void;
  loadCommands(): Promise<SlashCommand[]>;
  loadFiles(): Promise<string[]>;
  end(): Promise<boolean>;                   // DELETE, then drops it from the list; true when ended
  sayToast(text: string): void;
};
```

`SessionSnapshot` holds everything the screens read:

- `view` (the journal's `SessionView`), `known` (the list's row, or the last one seen, or the one it ended
  as before this screen opened), `kind`, `link` (`LinkState`)
- derived, by one pure function `sessionState(...)` exported for tests: `ended`, `status`, `header`
  (`headerStatus`), `covered`, `mode` (the last one read while a dialog covers it), `queued`
  (`queue(view, taking)`), `queueWhy`, `suggestion` (null once dismissed, or when not idle), `dialog`
  (the `OnScreen` whose panel or opened choices show as a dialog, or the one being settled), `workingSince`
- local: `ctrl`, `toast`, `switching`, `commanding`, `settling`, `refill`, `nudge`, `models`, `ending`

The session owns what the two screens did in effects. It opens the link while held and closes it on stop. It
follows the journal while the session is Claude's. It marks the session seen on open, on each new
activity, and on close. It fetches the model list once. It clears the toast after 2.5 s, and clears
`commanding` and `settling` after 10 s or when the screen they wait on comes. Answers that arrive after
the session stopped change nothing in it (rows the Mac sent back still go into the journal, which is the
app's).

### 2. The chat list (`libs/client/src/chatEntries.ts`)

`chatEntries(input)` is a pure function. It takes the view, status, `answersOf`, `queued` and the dialog,
and returns `{ entries, inEntry, lastMine, workingStarted }`. Each entry has a kind, a stable `key`, and the
data its row needs:
`tools | turn | answer | empty | live | bubble | failed | background | working | ask | choice | tick |
waiting`. A `turn` entry carries `last`, `rewind` and `retry` flags; the app attaches its own handlers to
those flags. The apps keep their own row components (DOM and native) and switch on `kind`.

### 3. The composer (`libs/client/src/composer.ts`, `libs/client/src/hold.ts`)

`createComposer({ draftKey, drafts, snippets, loadCommands, loadFiles, onSend, onError, recognize })`
returns a store with text, caret, focus, attachments, the `/` menu (`offered`, `said`), the `@` menu
(`mentioned`), `uploading`, the voice `hold` and `speech` (whether to offer it). Its actions:

- `type`, `setCaret`, `focus`, `blur`, `refill`, `pickCommand`, `pickSnippet`, `pickFile`
- `attach(kind, name, upload, source?)` and `progress(key, share)`
- `send(): boolean`
- `pressIn`, `move(zone)`, `letGo(zone | null)`, `dropTalk()`

Attachments are one shape on both apps: `{ key, kind: 'picture' | 'video' | 'file', name, piece | null,
sent?, source? }`. A picture's piece is its quoted path, which is how the web app sends it today
(`withPictures` is `withPieces` with quoted paths). A message taken back to change brings back its files
as well as its pictures on both apps; the web app used to drop the files.

`hold.ts` holds the press-and-hold logic both composers repeat. A press starts a 300 ms timer. Released
before the timer fires, it is a tap and focuses the field. Once the timer fires, listening starts, and
`move(zone)` and `letGo(zone)` steer it. The app keeps what only it can do: the field, the pickers, and
mapping a finger's position to a zone (`zoneAt`).

### 4. The session list (`libs/client/src/sessionListView.ts`)

`listView(sessions, query)` is pure: it sorts by last activity, matches the search, and groups by folder,
with no heading when there is one folder. The Mac's other conversations stay as they are: each app's
`useMacSessions` is five lines that call the shared `followMacRecent` and `macShown`.

### 5. The apps

- Web: `src/platform.ts` adds `sessions = createSessions(...)`. A new `src/store.ts` holds `useStore`.
  `pages/Session.tsx` and `components/ChatView.tsx` keep their markup and read the snapshot. The same goes
  for `components/Composer.tsx` and `pages/Sessions.tsx`.
- iPhone: the same in `src/client.ts`, `src/store.ts`, `app/session/[id].tsx`, `components/Composer.tsx`
  and `app/index.tsx`. `hooks.ts` keeps only what is not about a session (login, accounts).
- Each screen takes its session `id` as a prop. On the web it already does; on the iPhone the route file
  passes `useLocalSearchParams().id` to the screen component. That lets the wide-screen layout put a list
  and a session side by side.

### 6. Wide screens (web)

From 900 px wide, the web app shows the session list in a 320 px column on the left, and the open session
(or a "choose a session" note) on the right. Below 900 px it stays one page at a time, as now. In the
session pane, the chat, the cards, the queue tray and the composer share one column, at most 760 px wide
and centred. The list marks the open session. Opening one from the list replaces the right pane without
leaving the list.

### Where the apps differ today, and which way each goes

Where the two copies disagree, the core takes the iPhone's version. It is the newer of the two: the
iPhone app was brought to parity with the web in `2026-10-05-mobile-web-parity.md` and has changed since.
The one exception is called out.

| # | Behaviour | Web today | iPhone today | Core |
|---|---|---|---|---|
| 1 | A command from the pill | runs again if pressed again | one at a time until its dialog shows or 10 s pass; refreshes the journal after | iPhone |
| 2 | A key pressed in a card or dialog | on the session's socket | as a request (`/keys`, `/close`); the answer brings the next screen | iPhone: a slow line can hold the socket for seconds |
| 3 | A pick in a dialog | nothing held | the dialog stays, busy, until the next screen is read | iPhone (the web's markup shows the held dialog the same way it shows a live one) |
| 4 | "Continue" under the last reply | hidden while a message is in state `queued` | hidden while anything is in the tray | iPhone: the tray is what the user sees |
| 5 | "No conversation yet" | hidden while a message is `queued` | hidden while anything is in the tray | iPhone, same reason |
| 6 | The key bar | always shown | hidden until the composer's keys button shows it; the choice is kept | iPhone, on both: the bar takes a row most people rarely use, and on a desktop the keyboard has the keys |
| 7 | Ending a session | tap End twice within 3 s | an action sheet's destructive choice | unchanged: the confirmation is the app's; the core only ends it |
| 8 | A dialog over the chat | inline at the end of the chat | a popup | unchanged: layout is the app's; the core says which dialog is up |

### Spike: can the iPhone app's code be the web app? (React Native Web)

The question is whether `apps/mobile`, built for the web by Expo, could replace `apps/web`. That would
make the screens shared too, not just the logic. The spike is throwaway, done on its own branch, and
answers only that.

The probe: `npx expo install react-dom react-native-web @expo/metro-runtime` in a scratch worktree,
`expo export -p web`, serve the output behind a local server, and walk it in Playwright. Pass criteria,
each one measured:

1. It builds. List every module that has no web build and what replaces it: `expo-secure-store` (empty
   on web), `expo-file-system`, `react-native-keyboard-controller`, `expo-symbols` (needs `fallback`),
   `ActionSheetIOS`, `expo-notifications`.
2. First load is no more than twice the current web app's (gzip JS), measured from `dist`.
3. A 500-turn chat scrolled from end to start in Playwright's iPhone WebKit profile keeps the 95th
   percentile frame under 32 ms, sampled with `requestAnimationFrame`. The current web app is measured the
   same way, for comparison.
4. Text in a reply can be selected and copied (selection API in WebKit and Chromium).
5. At 1440 px it can do the two-pane layout above (Expo Router layout plus `useWindowDimensions`).

The output is a recommendation with the numbers, written to `docs/private/`; no code from the spike is
kept. Two checks cannot be made headless and need a real iPhone: Safari as a home-screen app, and whether
the composer stays above the real on-screen keyboard. The report lists them for a person to do.

## Testing (goal D)

- Tests first for each core module (`libs/client/tests/*.test.ts`, Vitest, Node). The fakes in
  `tests/fakes.ts` already drive sockets, storage and visibility; a fake `api` is added there. It holds
  each request until the test answers or fails it, so a request in flight can be tested, and it names what
  is waiting when a test answers something that is not.
- `session.test.ts` covers each action on each path:
  - in flight, answered, refused (4xx/5xx), unreachable, 404 meaning "already sent", and an answer
    arriving after the session stopped
  - a send while a panel is open, while Ctrl is armed, and while the link is down
  - two presses within one tick, and a second press after the first has answered
- `session-state.test.ts` covers `sessionState` for every status, with and without a dialog, an ended
  session, and one that ended before the screen opened.
- `chat-entries.test.ts` covers each entry kind, and the rows from the drift table above.
- `composer.test.ts` and `hold.test.ts` cover drafts, refill merging, menus, attachments still uploading,
  a hold sent with an attachment on its way up, a tap against a hold, and speech refused.
- No new UI tests. Each app runs `typecheck` and `lint`. The web app gets Playwright screenshots of the
  session screen and the list at 390, 768, 1024 and 1440 px against a throwaway server. The iPhone app is
  bundled with `expo export -p ios` to catch broken imports.
- Locally only the changed test files run, under `nice -n 19`; the machine is serving the live install.

## Order

1. React-free stores and the binding file in both apps (no behaviour change).
2. `session.ts` with its tests; then the web screen on it; then the iPhone screen on it.
3. `chatEntries.ts` with its tests; both chat lists on it.
4. `composer.ts` and `hold.ts` with their tests; both composers on them.
5. `sessionListView.ts` with its tests; both lists on it.
6. The web wide-screen layout and the key-bar change.
7. The React Native Web spike and its report.

Each step leaves both apps building and working, so the branch can stop after any one of them.
