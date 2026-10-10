# iPhone app vs web app: parity of the session screen and the list

Status: done. Every "differs" / "missing" row is fixed, apart from three marked impossible (rows 32, 43, 44),
each because it needs a native module the frozen build 11 binary does not have, or one iOS lacks. The web app
is the spec. Line numbers in the "Web" and "Phone" columns are from the audit (0c62ac7 plus the uncommitted
build 11 tree), before the fixes.

Web paths are under `apps/web/src/`, phone paths under `apps/mobile/src/`.

## The two reports

**"A message I send does not show in the app at once; it takes a while"** (row 13). Both apps draw a "Sending…" bubble the moment
send is pressed, and the phone does it the same way as the web. But the message POST is the one request
with no timeout (`libs/client/src/api.ts:81`). The sender queues each message behind the one before it
(`libs/client/src/messages.ts:12-21`). So a POST that leaves on a connection iOS has not yet noticed is
dead hangs until iOS gives up, which can take tens of seconds. That message, and every message after it,
sits as "Sending…" all that time. A phone back from the background, or one switching networks, hits this
far more often than a desktop browser does.

Not proven as the only cause. Fixed in the shared client, so both apps get it.

Probe (a production server's logs, read only, `~/.workoffdesk/logs/workoffdesk.log`):
- The server logs a request only when it fails (status 400 or more) or takes over 1s (`apps/server/src/app.ts:131-135`). No `POST .../messages` ever appears, so none was slow or refused on the Mac side. The delay is not in the server's handling.
- The POST arrival times can't be set against the transcript, because fast successful requests leave no line.
- `queue.json` is empty, and nothing shows a message held in the queue, so B (queueing) is not the cause.
- The tunnel restarts with every server restart: 7 "Starting tunnel" lines, one today at 04:52Z. A POST sent during one has no answer and, before this fix, waited until iOS gave up on the connection. This is cause A.

Conclusion: consistent with A, not with B. The phone now gives up on a try after 15s and sends the same id again (`libs/client/src/api.ts`). After a 502/503/504 it waits 0.3, 1, 2 and 4s between tries. The queue tray is unchanged, as on the web.

**"Once the keyboard is up, it never goes away"** (row 15). The chat list uses `keyboardDismissMode="interactive"`
(`app/session/[id].tsx:372`). iOS only starts an interactive dismiss once the finger crosses the
keyboard's top edge. Between the list and the keyboard sit the key bar and the composer (about 110pt), so
a downward drag that starts in the chat almost never gets there. Even when it does, the
KeyboardAvoidingView does not follow the finger. Taps don't work either: with
`keyboardShouldPersistTaps="handled"`, a tap on a message counts as handled, because every message is
wrapped in `SelectableMessage`'s Pressable (`components/SelectText.tsx:13`). So it does not dismiss. Only a
tap on bare background works, and an inverted short chat has little of it.

On iOS Safari, the web app loses the keyboard on any tap outside the textarea. Buttons that must keep it
(keys, card options, send) opt out with `press()` (`components/KeyBar.tsx:6-9`).

## Table

| # | Web behaviour | Phone behaviour | Verdict | Fix |
|---|---|---|---|---|
| **Composer** | | | | |
| 1 | Empty, unfocused, enabled input is itself the hold bar: tap focuses, hold 300ms talks, drag picks send / cancel / to text, release ends (`components/Composer.tsx:198-233, 364-376`) | Separate mic button beside the input; a tap only shows "hold to talk" (`components/Composer.tsx:317-333, 203-223`) | differs | fixed: bar over the empty input, mic button removed |
| 2 | Once the phone refuses speech for the visit, the bar stops offering it and reads as a plain placeholder (`Composer.tsx:72-73, 171-178, 374`) | Keeps offering; says "unavailable" on every hold (`Composer.tsx:198-199`) | differs | fixed: same `speech` state, seeded from `isRecognitionAvailable()` |
| 3 | Voice panel: full-width blue glow from the bottom, two round targets, a hint, a wave (`styles.css:308-361`, `Composer.tsx:411-456`) | Small grey card above the composer (`Composer.tsx:356-388`) | differs | fixed: same layout, gradient via RN `experimental_backgroundImage` |
| 4 | Return sends (`enterKeyHint="send"`, Enter → send, never mid-IME) (`Composer.tsx:149-155, 349`) | Return types a newline | differs | fixed: `returnKeyType="send"` + `submitBehavior="submit"` (the IME confirm key does not submit) |
| 5 | Snippets come first after `/`; edited in Settings (`Composer.tsx:102-107, 245-258`; `pages/Settings.tsx:46-63`) | None | missing | fixed: parsing moved to libs/client; phone Settings edits them, same key `workoffdesk.snippets` |
| 6 | `/` commands, `@` files (`Composer.tsx:93-132`) | `Composer.tsx:108-140, 239-268` | same | |
| 7 | Pictures (`Composer.tsx:157-169, 294-325`) | `Composer.tsx:142-168` (also several at once, and the camera) | same | |
| 8 | Stop while working / send when not empty; draft kept; refill (`Composer.tsx:60-68, 378-397`) | `Composer.tsx:84-94, 334-348` | same | |
| 9 | Session pill under the composer: model (opens `/model`), permission mode menu (Shift+Tab until the screen shows it), effort (`/effort`), context % with a usage menu and Copy (`components/KeyMenus.tsx:16-171`; `pages/Session.tsx:158-182, 301-305, 483-492`) | None | missing | fixed: mode stepping and usage lines moved to libs/client; phone pill with the same menus |
| **Sending** | | | | |
| 10 | "Sending…" bubble at once, then "Sent" until the transcript has it (`pages/Session.tsx:264-280`, `components/Outbox.tsx:22-66`) | `app/session/[id].tsx:171-187, 278-297`, `hooks.ts:58-78` | same | |
| 11 | Messages Claude cannot take yet wait in the tray above the composer, not in the chat (`components/QueueTray.tsx`) | `components/Footer.tsx:47-87` | same | kept as the web has it |
| 13 | Message POST: no timeout; one hung request holds this message and every later one (`libs/client/src/api.ts:81`, `messages.ts:12-21`) | same code | same, wrong in both | fixed in libs/client: each try is given up after a while and tried again; the server takes a message id once |
| **Keyboard** | | | | |
| 15 | Tap anywhere outside the input puts the keyboard away; keys, card options and send keep it; send puts it away (`KeyBar.tsx:6-9`, `Composer.tsx:145-146`) | Interactive dismiss that needs the finger to reach the keyboard; taps on messages taken by Pressables (`[id].tsx:372-373`) | differs | fixed: a drag on the chat (`keyboardDismissMode="on-drag"`) or a tap on its background (the list's own `keyboardShouldPersistTaps="handled"`) puts it away. A tap on a message's words puts it away too: its text view does not take the tap. A card's controls keep it, as on the web. Opening the screen, select-text, rename or action sheets, or the picture menu, puts it away first. The input then blurs, so with nothing typed the hold bar is back, as on the web (`showBar = !text && !focused`) |
| 16 | Composer stays above the keyboard (`pages/Session.tsx:30-95`) | KeyboardAvoidingView (`[id].tsx:357`) | same | |
| **Key bar** | | | | |
| 17 | Paste key: types the clipboard into the session (`KeyBar.tsx:25-27`, `pages/Session.tsx:184-191`) | None (`components/Footer.tsx:17-43`) | missing | fixed: `expo-clipboard` (already in build 11). Also on the screen sheet's keys. The other keys (`KEYS`, Ctrl, ⏎) were already the same |
| **Chat** | | | | |
| 18 | Choice, tick, panel cards; waiting bar (`components/cards/*`, `ChatView.tsx:357-394`) | `components/Cards.tsx`, `[id].tsx:321-330` | same | |
| 19 | Send held by a panel: the bar shakes on each try (`styles.css:570-571`) | Remounts, no motion (`[id].tsx:412`) | differs | fixed: same shake |
| 20 | Under the last reply: Copy, Read aloud (`components/TurnView.tsx:237-274, 282`; `ChatView.tsx:302-307`) | None | missing | fixed: `expo-clipboard`, `expo-speech` (both already in build 11) |
| 21 | Copy button on each code block (`TurnView.tsx:9-34`) | None (`components/Markdown.tsx:40-47`) | missing | fixed |
| 22 | Under the last message sent, while idle: Copy, Rewind (`/rewind`) (`TurnView.tsx:184-232`, `ChatView.tsx:173-175, 309-313`) | Time only (`components/Turn.tsx:140-152`) | missing | fixed |
| 23 | Changed-files card: a tap opens that call in the chat and scrolls to it (`TurnView.tsx:83-109`) | Not tappable (`Turn.tsx:169-187`) | missing | fixed |
| 24 | A picture shown earlier: "See image above" scrolls to it (`TurnView.tsx:305-317, 392-396`) | Dropped silently (`Turn.tsx:247`) | missing | fixed |
| 25 | Web images in a reply as links "Web image · host" (`TurnView.tsx:284-292`) | Dropped (`Turn.tsx:154-167`) | missing | fixed |
| 26 | Picture viewer (`TurnView.tsx:147-161`) | Full-screen modal (`Turn.tsx:67-91`) | same | |
| 27 | Tool rows, tool details, diffs, notes, Try again (`TurnView.tsx:322-443`) | `Turn.tsx:189-327` | same | |
| 28 | Live text, working timer, background commands (`ChatView.tsx:342-356`) | `[id].tsx:298-320` | same | |
| 29 | To-bottom button; a send goes back to the end; earlier turns load at the top (`ChatView.tsx:186-256`) | `[id].tsx:163-166, 367-390` | same | |
| 30 | Long own messages fold at 12 lines / 600 chars (`TurnView.tsx:177-216`) | `Turn.tsx:105-138` | same | |
| 31 | Links in replies open (`markdown.ts`) | `Markdown.tsx:6-16` (also in own bubbles) | same | |
| 32 | Select any part of any text | Any part of a message selects in place: its words are drawn by a UITextView (`@bsky.app/react-native-uitextview`), as a React Native `Text` copies only whole | differs | the paragraphs, headings, lists and quotes that follow one another are one text view, so a selection runs across them; a code block or a table is a text view of its own (`Markdown.tsx` `Prose`; indents and paragraph spacing come from `patches/@bsky.app__react-native-uitextview@2.7.1.patch`) |
| **Header and session** | | | | |
| 33 | Tap the title to rename; an empty name goes back to the folder's (`pages/Session.tsx:334-342`, `components/RenameSheet.tsx`) | Title not tappable (`[id].tsx:337-347`) | missing | fixed: the title opens the rename sheet (`components/RenameSheet.tsx`) |
| 34 | End, tap again to confirm (`pages/Session.tsx:215-234, 344-353`) | None | missing | fixed: the one right header button is now "⋯", which opens an action sheet with Show screen / Rename / End session. End session is the sheet's destructive choice, so the sheet is the confirm step |
| 35 | Ended: Back and "Start another" in the same folder (`pages/Session.tsx:400-420`) | Back only (`[id].tsx:404-408`) | missing | fixed |
| 36 | Status chip in the header | Status in the subtitle | same | the lead's layout |
| 37 | Screen sheet: text and Refresh (`components/ScreenSheet.tsx`) | Also a header button, live refresh, keys (`Footer.tsx:116-203`) | phone has more | kept |
| **List** | | | | |
| 38 | Swipe a row left for Rename (`pages/Sessions.tsx:82-172`) | None (`app/index.tsx:20-60`) | missing | fixed: a long press on a row opens Rename (the lead's call), also offered as a VoiceOver action |
| 39 | "Other Claude sessions on this Mac": the last 24h, at most 20, kept for the next open, retried until the Mac answers (`pages/Sessions.tsx:23-80, 245-266`) | None | missing | fixed: moved to libs/client; the phone shows them and opens them read-only |
| 40 | Search, projects as groups, unread / busy / needs-you (`pages/Sessions.tsx:174-243`) | `app/index.tsx:62-134` | same | |
| **Settings** | | | | |
| 41 | Snippets editor (`pages/Settings.tsx:46-63`) | None | missing | fixed: same key `workoffdesk.snippets`, through `libs/client/src/snippets.ts` |
| 42 | Passkeys listed, each deletable (`pages/Settings.tsx:136-165`) | None | missing | fixed |
| 43 | Add a passkey (WebAuthn) | None | missing | impossible: needs a native passkey module, and native dependencies are frozen at build 11 |
| 44 | Push notifications switch (Web Push) | None | missing | fixed in build 12: `expo-notifications`; the server sends through APNs (`apps/server/src/apns.ts`) with the key named in `~/.workoffdesk/apns.json`; Settings has the same switch, a tap opens the session, logging out stops them |
| 45 | Text size, logged-in devices, log out | same | same | the phone also shows the server it is signed in to |
| **Found in testing** | | | | |
| 46 | (Web: the browser picks the language) | Hold to talk does nothing visible when the phone's language-region has no recognizer (English UI in China is `en-CN`). The native `start()` takes only an exact match from `SFSpeechRecognizer.supportedLocales()` and sends `language-not-supported`, then `end`, before any permission check (`speech.ts` `hearIn()`) | wrong | fixed. The invariant: a hold always either listens or says why it can't. `libs/client/src/hearLocale.ts` picks the locale from `getSupportedLocales()`: each language the phone lists, in its own region, then where the language is at home (en→US, zh-Hans→CN, zh-Hant→TW, …), then any region Apple has; then `speechLocale` the same way. None fits → the hold says `t.speechLanguage` without starting. `language-not-supported` gets its own message. The recognizer ending before the microphone came on, with no reason (or no-speech or aborted), now closes the panel and says speech is unavailable (`talk.ts`); before, that left a panel that heard nothing |
| 47 | — | new-session: after Resume a recent Claude → ‹, the menu step keeps a dead ‹ | wrong | fixed. The invariant: the header shows exactly the items the screen asks for now. `bareHeader` takes both sides as required keys (`Item \| null`) and always sets them, null as an empty item list, because Stack.Screen options are merged into the previous ones. A pushed screen that draws its own right side passes `left: back`, so the layout's back button is not wiped. The type makes a forgotten side a compile error |
| 48 | — | A screen showed a platform's error text: settings with the server down read "fetch failed: UnexpectedException: Could not connect to the server. (at ExpoModulesCore/Promise.swift:56)"; the rename sheet showed any error's message | wrong, in both | fixed, as a class. The rule: no screen shows a native or transport error. `api.ts` wraps every fetch that gets no answer (refused, dropped, timed out) in `NetworkError`, and keeps a non-JSON answer's status text and page out of the error. `errorText` says only what the server said (a code in the phone's words), `t.noServer` for no answer or a 502/503/504 page, or the caller's fallback, never an error's own text. Both rename sheets now go through it. Login (`libs/client/src/login.ts`): `signInTo` tells a token the phone could not keep (`LoginNotKept`, e.g. keychain -34018) from one it could not get, and `loginErrorText` gives `t.loginNotKept`, the password / too-many-tries words, `t.noServer` only for no answer, else `t.loginFailedOther`; both login screens use it. Ending a session and running /model or /effort blamed the connection for any failure; they now say "cannot reach" only for no answer (`errorText`'s third argument) and "Not ended / Not run, try again" otherwise |
| 49 | Speech errors read "Speech recognition stopped: <code>" | same | wrong, in both | fixed: `speechErrorText(code)` (`talk.ts`) says each known reason in words (en and zh) and anything else as "Speech recognition stopped. Hold to try again." |
| 50 | (Web: the login is a cookie, nothing to keep) | A sign-in whose token the keychain refused left that login live on the server | wrong | fixed: `signInTo` (`login.ts`) signs the token out again with `POST /api/auth/logout` (Bearer) before it reports `loginNotKept`; a failed sign-out still reports `loginNotKept`. The rule: a failed sign-in leaves no live login behind. |
| 51 | The pill coloured "Context 42%" red when the 5-hour limit was at 91% | same | wrong, in both (HEAD did it) | fixed: `pillFigure(u)` (`usage.ts`) picks what the pill shows. The red follows the number it is next to: a high context shows the context in red; otherwise a high 5-hour or 7-day limit shows itself ("5-hour 91%") in red; otherwise the context, plain. |
| 52 | A tap outside the input or on a message, or a drag, takes focus from it (the browser does it) | With a hardware keyboard (iPad, Bluetooth, the simulator) none of these blurred the composer, so the hold bar never came back: RN's `keyboardDismissMode` and the scroll view's tap dismissal act only while a software keyboard is up | wrong | fixed: the chat's view takes any touch nothing inside claims and calls `Keyboard.dismiss()` on release, and the list calls it on `onScrollBeginDrag`; `Keyboard.dismiss()` blurs the focused input through `TextInputState` whether or not a keyboard is shown. A message's own tap already did. Card controls still claim their taps and keep focus. |
| 53 | A write the server never answers spun forever | same | wrong, in both | fixed: every request ends within a bound (`api.ts`). A write that is not idempotent is sent once and given up on after 15 s plus the time its body takes at 25 KB/s, then says `t.noAnswer` ("may or may not have happened") through `errorText`; reads and deletes are retried as before. |
| 54 | Settings with the server down: the lists stayed "Loading..." | Passkeys said "No passkeys yet", devices stayed "Loading..." | wrong, in both | fixed: `listed()` (`listed.ts`) makes a list loading, failed (in words, with Try again) or loaded; a failure is never empty or loading. |
| 55 | "Add one to log in with Face ID" sits over an Add button | the same words, with no button | wrong | fixed: the phone says to add one in the web app's Settings (`passkeyNoneOnPhone`). |
| 56 | — | A jump from a card with the keyboard up landed behind it | wrong | fixed: a jump puts the keyboard away first. |
| 57 | An ended session's chip kept the list's last status ("Idle"); the overlay blurs the chat | same chip; the overlay's words sat on the faded chat | wrong, in both / phone | fixed: both say Ended once the session has ended; the phone's overlay draws its words on a plate (no blur without a new native module). |

(Rows 12 and 14 were merged into 13 and 15. Rows 32-45 also cover the lead's notice list: claudeHasOpen,
heldWhilePanel and sendPaused are in `components/Cards.tsx` (SendHeld); claudeWaiting is in WaitingBar. All
were already the same.)

## Needs the lead (server)

`Outbox.send` (`apps/server/src/outbox.ts:74-83`) records a message id only *after* the paste finishes. A
second POST with the same id that arrives while the first is still pasting is pasted twice. The client
now tries a hung POST again, so this window is reachable. The fix is to note the id as in flight before
`await this.deliver`. Until then, the client waits 15s before giving up on a try, to keep the window small.
In progress in the working tree: `Outbox.delivering` answers a second send of an id that is still being pasted
with the first one's result.

## Where it went

1. libs/client (test first: red, then green, then a mutation check)
   - `api.ts`: a write marked `idempotent` has a 15s timeout on each try and is retried with the send delays.
   - `messages.ts` marks its POST that way.
   - New modules: `snippets.ts`, `modes.ts`, `usage.ts`, `macRecent.ts`, and `firstShowing` in `images.ts`.
   - The web uses them, with no change in behaviour.
   - Tests:
     - `send-message.test.ts`;
     - `snippets`, `modes`, `usage` and `mac-recent` tests;
     - three cases in `images.test.ts`;
     - the restart case moved from `kept.test.ts` to `send-message.test.ts`, because the retry now lives in `api`.
2. Phone
   - `components/Composer.tsx`: hold bar, voice panel, Return sends, snippets, footer slot.
   - `components/SessionPill.tsx`.
   - `components/Footer.tsx`: Paste.
   - `components/Cards.tsx`: shake.
   - `components/Turn.tsx`: reply and own-message actions, jumps, web images.
   - `components/Markdown.tsx`: code copy.
   - `components/RenameSheet.tsx`.
   - `components/SelectText.tsx`: puts the keyboard away.
   - `app/session/[id].tsx`: keyboard, ⋯ sheet, end, start another, pill, rewind, jumps.
   - `app/index.tsx`: long-press rename, Mac sessions.
   - `app/settings.tsx`: snippets, passkeys.
   - `speech.ts`: the locale from `hearLocale`; a stop or abort before the locale is chosen ends it locally.
   - `components/header.tsx`: both sides always set.

## Walk-through after build 12 (2.17.21)

A tester went through every feature on both, side by side, on the simulator (build 12) and in Chromium. What it found, all fixed in 2.17.21 unless noted:

- **Both**: an ended session showed "Reading…" forever, still offered ⋯ and rename; switching mode gave no sign until the screen moved; a message just sent showed no pictures until Claude had it; going to a call nested in another left the outer one shut; the working time could start at the page load or at a stale message; deleting a passkey or revoking a device went at the first tap; a 404 showed the server's raw words.
- **Phone only**: code had no colours (highlighting moved from the web to `libs/client/highlight.ts`, now shared); buttons in cards, code and diffs needed two taps with the keyboard up; the stop button was not red; ⏺ in the footer was drawn as an emoji; the login form sat under the keyboard.
- **Web only**: Enter while a picture uploaded sent the text alone and left the picture behind.
- **Not testable here**: real push delivery (needs the APNs key, see the README), the microphone, and passkey add (impossible, row 43).
