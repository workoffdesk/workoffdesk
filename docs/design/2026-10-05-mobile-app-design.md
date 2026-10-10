# The iPhone app (React Native)

2026-10-05. Status: v1 in progress.

## What it is

A native iPhone app that does what the web app does, against the same server on the Mac, with the same rules.
The web app stays; the native app is for what a home-screen web app does badly: Keychain login, a native
keyboard and lists, and later APNs push and passkeys.

## Invariants

1. **The app and the web app are two faces of one client.** Anything that is not drawing a screen — the API,
   the chat model, formatting, the words — lives once in `libs/` and both use it. A fix to the chat model
   lands in both.
2. **The Origin check guards exactly the credentials a browser attaches on its own.** A cookie is sent by
   the browser to any page that asks, so a request riding on it must come from our origin. An
   `Authorization: Bearer` header is only ever there because our own code put it there, so no other site
   can make a browser send it; a request that authenticates with it needs no Origin.

## Layout

```
apps/server   workoffdesk (npm): Fastify + CLI, unchanged layout dist/server + dist/web
apps/web      @workoffdesk/web: Vite PWA
apps/mobile   @workoffdesk/mobile: Expo (SDK 57), expo-router
libs/i18n     @workoffdesk/i18n: the words, en + zh (web + mobile)
libs/client   @workoffdesk/client: API client, chat model, formatting — platform-free TS
```

Shared libs are TypeScript source consumed by the bundlers (Vite, Metro). The server is compiled by plain
`tsc` into a multi-file dist that the deploy and smoke scripts rely on, so it may import them for types only.

## Login: a bearer token for the app

The login record already exists (`LoginSessions`: validate, revoke, last seen, the device list in Settings).
The app gets the same record delivered differently:

- `POST /api/auth/token` — same password check, lockout, audit and one-at-a-time queue as
  `/api/auth/password`; answers `{ token }` and sets no cookie. No Origin check: with no cookie set there is
  no login CSRF.
- `Guard` reads the credential from `Authorization: Bearer <id>` when the header is there, and then **ignores
  the cookie** — otherwise a forged bearer could switch off the Origin check while the cookie authenticates.
  The Origin check applies only when the credential came from the cookie.
- WebSockets: React Native's `WebSocket` takes headers, so the same header authenticates the upgrade.
- Logs redact `req.headers.authorization` as they redact the cookie.
- The app keeps the token in the Keychain (`expo-secure-store`); 401 / close 4401 sends it to the login
  screen.

Breaking paths, each a test: bearer with no Origin on a write (allowed); cookie with no Origin on a write
(refused, as today); a bad bearer next to a good cookie with no Origin (refused, 401); revoked token on HTTP
and on an open socket (401 / closed 4401); token login wrong password counts toward lockout; token login sets
no cookie; the authorization header never reaches the log.

## libs/client

Moved from `apps/web/src`, made platform-free by taking what differs as configuration:

- `api.ts` — `configureApi({ baseUrl, headers, onUnauthorized })`. The web passes `''`, no headers, and a
  redirect to `/login`; the app passes the server address, the bearer header, and a jump to its login
  screen. `wsUrl` derives from `baseUrl`.
- `chat.ts`, `format.ts`, `sent.ts`, `pushes.ts`, `retry.ts`, `slash.ts`, `keys.ts` — moved as they are.

## The app, v1

Screens: server address + login, the session list (live from `/api/events`), a session's chat (turns,
choice/panel cards, the composer, the Esc/continue keys), settings (text size, light or dark, the language, log out).

Not in v1, each needing an Apple Developer account:

- **Push**: APNs needs an Apple Developer push key; the server needs an APNs sender beside web-push.
- **Passkeys**: need `apple-app-site-association` on the site's domain and an Associated Domains entitlement.
- **TestFlight / App Store**: an Apple Developer account and a bundle id.

Image upload, voice input and the screen view follow in v1.1.

## Checking it

`pnpm -r typecheck` and `lint` cover the libs and the app. The app is run in the iOS Simulator against a
local server (a throwaway home and tmux socket, as the web screenshots are taken) and screenshotted with
`xcrun simctl io booted screenshot`; the screenshots are looked at before it is called done.
