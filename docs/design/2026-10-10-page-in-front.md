# Only the page in front asks the Mac

2026-10-10. On the iPhone, opening a session from another session's page left the first page mounted
underneath. It went on asking the Mac for its journal every 1.2 s, told the Mac it was being looked at (so the
Mac read its screen every 250 ms and sent no notification for it), and marked the session seen as things
happened in it. Over a slow line those asks queued in front of the page actually shown, which then took
seconds to load.

## What must hold

A page that is not in front of the app does nothing on the user's behalf: it asks the Mac nothing, does not
count as looked at, and marks nothing seen. Coming back in front, it catches up at once.

## Who knows

The navigator knows which screen is in front (`useIsFocused` from expo-router); the app knows whether it is
in the foreground (the `Visibility` each app already has). Nothing else keeps a copy of either.

## How

- `inFront(app, front)` in `libs/client/src/base/platform.ts` makes a screen's own `Visibility`: visible
  while the app is and the screen is in front. `useInFront` in `libs/react/src/store.ts` keeps one per screen.
  The iPhone app passes `useIsFocused()`; the web app shows one page at a time and passes the app's own.
- What reads for a page takes that page's `Visibility`, not the app's: `journals.follow(id, page)`,
  `chatFeeds.follow(…, page)` and `links.open(id, page, …)`. There is no app-wide one to reach for by mistake.
- A session held by several screens is looked at while any of them is in front (`anyOf`). It is marked seen as
  it comes in front, as it leaves the front, and as something happens in it meanwhile (`seenWhileInFront` in
  `libs/client/src/sessions/seen.ts`).

## What still flows to a page behind

- The session's socket stays open, so coming back needs no new line, and the journal rows the Mac pushes on
  it are still applied.
- The session list and every session's journal version come over `/api/events` for the whole app, so the
  list's order, times and badges are as current as before.

Coming back in front, the page reads its journal at once and tells the Mac it is looked at, which reads the
screen at once.
