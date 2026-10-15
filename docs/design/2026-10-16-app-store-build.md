# The App Store build: one update server, notifications through a relay that cannot read them

2026-10-16. Status: design. Read from source: expo-secure-store 57.0.4 (`ios/SecureStoreModule.swift`),
expo-updates 57.0.24, `apps/mobile/app.config.ts`, `apps/mobile/src/appUpdate.ts`,
`apps/mobile/src/notifications.ts`, `apps/server/src/notify/{push,apns}.ts`, `apps/server/src/http/app.ts`.

Until now every copy of the iPhone app was built by the person who runs the server: their bundle id, their
APNs key in `apns.json`, JS updates from their own server
([2026-10-05-mobile-ota-updates-design.md](2026-10-05-mobile-ota-updates-design.md)). An app published on the
App Store is one binary for many people, each with their own Mac. Three things then break:

1. **Notifications.** APNs takes pushes for a bundle id only from a key of the team that owns it. A person
   who installed the App Store app has no such key.
2. **JS updates.** Each person's Mac would push its own JS into a binary someone else published and signed.
   The publisher can no longer say what code the App Store app runs.
3. **Versions.** If the JS comes from one place, a person's Mac may be older or newer than the JS that talks
   to it, and today nothing compares the two.

Everything below is switched on by build settings that live outside the repository (next to the bundle id
in the publisher's own environment). A build without them, which is every build someone makes for
themselves, behaves exactly as before.

## 1. Invariants

- **A build that names an update server runs only JS from that server (or the JS inside it).** A build that
  names none keeps the rule of the 2026-10-05 design: JS from the https server it is signed in to.
- **What a notification says is readable only by the Mac that writes it and the phone that shows it.** The
  relay sees a device token, a topic, a time and an opaque blob.
- **The relay delivers only to the publisher's own app**, and only what a Mac encrypted for one device.
- **The app never quietly talks to a server too old for it.** It says so, and says how to update.
- **A build without these settings changes in nothing:** no extension, no relay, no new routes switched on.

## 2. Build settings

Read by `apps/mobile/app.config.ts`, like `WORKOFFDESK_IOS_BUNDLE_ID` today.

| Setting | Effect when set |
|---|---|
| `WORKOFFDESK_IOS_UPDATE_URL` | `updates.url` is this manifest URL, and `extra.updateUrl` carries it to JS. The app never overrides it. |
| `WORKOFFDESK_IOS_PUSH_RELAY` | `extra.pushRelay` is this https origin. The build gets a Notification Service Extension and an app group shared with it. |

Both are the publisher's: the update URL is the publisher's server's `/api/app-update/manifest`, the relay is
the same server (§4). Neither belongs in the repository.

## 3. JS updates from the build's update server

`apps/mobile/src/appUpdate.ts`:

- `updateUrlOf(login, fixed)`: `fixed` when the build names one, else today's derivation from the login.
- With a fixed URL, `useAppUpdates` clears any override once (`setUpdateURLAndRequestHeadersOverride(null)`,
  for a phone that ran a self-built copy under the same bundle id), and checks on start and on foreground
  after 15 minutes, as now. It no longer checks on a change of the signed-in server or of its release: those
  say nothing about the update server.
- Signing out changes nothing for updates.

The publisher's server already serves the manifest publicly (`apps/server/src/http/routes/appUpdate.ts`) for
the runtime it was built with. Nothing changes there.

## 4. Notifications through the relay

### The phone

At registration (`apps/mobile/src/notifications.ts`), a build with `extra.pushRelay`:

1. Gets or makes a 32-byte key (`expo-crypto`), kept in the keychain under service `push`, account `key`,
   access group `group.<bundle id>`, readable after first unlock (the extension runs on a locked phone).
   iOS lets an app group name serve as a keychain access group, so the extension reads the same item.
2. Sends `POST /api/push/apns` as today, plus `relay: { url, key }` and `words.hidden` (the text shown if
   the extension cannot decrypt).

The key is made once per install and sent to every Mac the phone registers with; each Mac sees only its own
messages, and a phone that is wiped makes a new key.

### The Mac (any workoffdesk server)

`apps/server/src/http/routes/push.ts` stores `relay` with the device (`ApnsDeviceRecord`). `Pusher` sends:

- **directly**, as today with a plain payload, when the device has no relay, or when this server is itself
  the relay for the device's topic (the publisher's own Mac). Needs the `apns.json` key, as today.
- **through the relay** otherwise, whether or not this server has a key: a key here is for the topic of
  the app its owner builds, not the App Store app's.
  `POST <relay>/api/push/relay { token, topic, sealed, thread, hidden }` where
  - `sealed` = base64 of AES-256-GCM `nonce(12) ‖ ciphertext ‖ tag(16)` (CryptoKit's `combined` layout)
    over `{"alert":{title,subtitle?,body},"sessionId"}` (the alert the direct path sends), under the
    device's key, a fresh random nonce each time;
  - `thread` = the first 16 hex characters of HMAC-SHA256(key, sessionId), so notifications of a session
    group together without naming it;
  - `hidden` = the phone's `words.hidden`.
  A `410` from the relay means the token is gone: the device is dropped, as for APNs today.
`GET /api/push/apns` answers `ready: true` when the server has a key or the app says it has a relay
(`?relay=1`, sent by a build with `extra.pushRelay`).

The 30-second cooldown per session stays in `Pusher`, before either path.

### The relay (the publisher's server)

A server becomes a relay when its `apns.json` names the App Store app's bundle id as `relayTopic`. Then,
and only then, it serves the public route `POST /api/push/relay`:

- `topic` must be that `relayTopic`; anything else is `403`.
- `sealed` ≤ 3 000 base64 characters, `thread` 16 hex, `hidden` ≤ 120 characters, `token` 64 hex; else
  `400`.
- At most 30 requests a minute per token and 600 a minute in all, else `429` with `retry-after`.
- It sends `{ aps: { alert: { body: hidden }, sound: 'default', 'mutable-content': 1, 'thread-id': thread },
  sealed }` and answers `200`, `410` when APNs says the token is gone, or `502` when APNs fails.
- It stores nothing and logs no token or blob.

No ticket or sign-up guards the route: the only thing it can do is send a message the app shows as
`hidden`-or-garbage to a token the sender already knows, and tokens are not public. The topic check keeps
it from being anyone else's push service, and the limits keep it cheap.

### The extension

A Notification Service Extension (Swift, CryptoKit), added at prebuild by a config plugin in
`apps/mobile/plugins/` only when `WORKOFFDESK_IOS_PUSH_RELAY` is set. For a payload with `sealed`, it reads
the key from the shared keychain item, opens the box, and sets title, body and `userInfo.body.sessionId`
(where tap routing already looks). Anything that fails leaves the notification as sent: `hidden`.

## 5. Server too old for the app

The client sends nothing new. It reads the release every answer already carries (`x-workoffdesk-version`,
`apps/server/src/http/app.ts`) and compares it with `MIN_SERVER` in `libs/client` (the oldest server release
the current client works against). Older: the app shows a screen saying the Mac's workoffdesk
needs updating, with the command, and the button to try again. No header says nothing (a proxy may drop it,
the demo has none) and blocks nothing. The web app is served by the server it talks to, so it never sees
this screen; a self-built app updated from its own server neither.

`MIN_SERVER` moves only when the client starts to need something a server older than it does not have.
Server routes keep answering older clients: an App Store binary can run its embedded JS for a while.

## 6. What the docs say

- README "No account, no relay of ours" becomes: no account; a copy you build talks only to your Mac and
  Apple; the App Store app's notifications pass through the publisher's relay, end-to-end encrypted.
  `docs/facts.md` gets the facts with the files that show them.
- A privacy page pair `docs/guide/privacy.md` / `privacy.zh-CN.md`: what the app keeps (sign-in in the
  keychain), where data goes (your Mac; for the App Store app, JS updates from the publisher's server and
  sealed notifications through its relay, which sees tokens, times and sizes), and that nothing else is
  collected. The App Store listing links to it.
- `docs/guide/ios-app.*`: the two settings, for anyone publishing their own build.

## 7. Ways it breaks, and what holds

| Case | What happens |
|---|---|
| App Store app, Mac with no `apns.json`, Mac older than this change | The Mac ignores `relay`; `ready` false; the app says notifications need the Mac's key or a newer release. |
| Relay down | The Mac's post fails; logged, nothing retried (as an APNs failure today). |
| Key lost (app reinstalled) | Phone registers anew with a new key and token; old token is gone at APNs and dropped on the first `410`. |
| Extension cannot read the key (phone not unlocked since boot) | Shows `hidden`. |
| Tampered or replayed blob | GCM fails → `hidden`. A replayed one shows an old message again; the 300-second APNs expiry bounds it. |
| Someone else's topic sent to the relay | `403`. |
| Flood of one token | `429` after 30 a minute. |
| Self-built app, Mac with `apns.json` | Unchanged: direct, plain payload, no extension. |
| App Store app, Mac with its owner's own `apns.json` | Through the relay; the owner's key is for another topic. |
| App Store app, Mac newer than the JS | Server keeps old routes; the JS works. |
| App Store app, Mac older than `MIN_SERVER` | Update screen. |
| Phone that ran a self-built copy, then the App Store one | Override cleared; JS from the update server only. |

## Not in this

- Android.
- A relay for web push: browsers already deliver web push without a key of ours.
- Proving that a relay request comes from a real install (App Attest): the route can do too little harm to
  need it.
