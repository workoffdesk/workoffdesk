# Over-the-air JS updates for the iPhone app, from the user's own server

2026-10-05. Status: design, nothing built. Read from source: expo-updates 57.0.24 (iOS client), @expo/cli
57.0.27 (`expo export`), @expo/config-plugins 57.0.9, @expo/fingerprint 0.20.13, expo-constants 57.0.20.
File references below are into the expo-updates package unless they start with `apps/`.

## The proposal, and where this design departs from it

The proposal: every server build carries the app's JS update for the native runtime it was built against
(`dist/app-update/ios/`, made by `expo export`), the server serves it over the expo-updates protocol, so a
server deploy also updates the app. A native change changes the runtime, the server stops offering to old
binaries, and a TestFlight build is needed.

That holds, with five changes:

1. **The route is public, not behind the bearer token.** expo-updates binds a downloaded update to the exact
   request headers it was fetched with (`LauncherSelectionPolicyFilterAware.swift`), and persists them in
   `UserDefaults` (`UpdatesConfigOverride.swift`) and in its SQLite `updates.headers` column. A token there
   leaves the Keychain, and every re-sign-in (new token) makes every cached update unlaunchable. The JS is
   not a secret: the same bundle is in the binary and in the public npm package, and `/healthz` already
   names the version.
2. **Runtime version is `fingerprint` with versions skipped.** By default the fingerprint hashes
   `version` and `ios.buildNumber` (`@expo/fingerprint` `normalizeExpoConfig`), so the build-number bump
   before every TestFlight upload would cut all current binaries off from updates. `fingerprint.config.js`
   skips them.
3. **`createdAt` is when the release became current, not when it was built.** The client never loads an
   update older than the one it runs (`LoaderSelectionPolicyFilterAware.swift`); expo's own guide says a
   server rollback "must actually be a new update with a later `createdAt`" (`guides/general.md`). Without
   this, `workoffdesk rollback` rolls the server back and leaves the phones on the newer JS.
4. **No code signing.** Shown in "Attacker" below: it cannot be done at build time, and at serve time it
   protects nothing the bearer token does not already expose.
5. **No separate JS-only channel.** A JS fix ships by `workoffdesk deploy`. A second channel is exactly the
   app/server drift this feature exists to remove.

## 1. Invariant

**The app runs a downloaded JS bundle only if it was built for the app's exact native runtime and came from
the https server the app is signed in to; otherwise it runs the bundle inside the binary.**

Corollary: for a given runtime, the phone runs the server's JS, even when that JS is older than the
binary's own. App and server move together.

## 2. Ways it breaks (trigger × timing), and what must stay allowed

| # | Trigger | When | What happens with this design | Held by |
|---|---|---|---|---|
| 1 | Server older than binary, same runtime | any check | Server offers its (older) update; phone runs it. Intended: that JS matches that server. | invariant corollary; `hasEmbeddedUpdate=false` under override (below) |
| 2 | Server older than binary, server predates this feature | check | `404` → check error → phone keeps embedded/cached | JS swallows check errors |
| 3 | Server newer than binary, runtime differs (native change on server) | check | Server answers `204` → no update; phone keeps the newest cached update for its runtime from this server, or embedded | server runtime filter; launcher runtime filter (2nd gate) |
| 4 | Runtime mismatch slipped past the server | download | Client does **not** check `runtimeVersion` at download (`ExpoUpdatesUpdate.swift` takes it verbatim); it only filters at launch. The update downloads and never launches, and "pending" never applies. | server must filter; test T2 |
| 5 | Half-downloaded update | app killed / network drops mid-fetch | Update stays `StatusPending`; only `StatusReady` is launchable (`UpdatesDatabase.launchableUpdates`). Each asset is hash-checked then written `.atomic`. | expo-updates |
| 6 | Half-written update on the server | build or deploy interrupted | `update.json` is written last by the build; deploy copies to `<name>.partial` then renames. No `update.json` or a listed file missing → `204`. | build step; route (T7) |
| 7 | Bad update crashes before first render | launch | ErrorRecovery marks it failed, asks the server for a newer one for 5 s (`checkAutomatically: ON_ERROR_RECOVERY`), else relaunches the previous cached update (reaper keeps launched + one older), else embedded. A failed id is never re-offered as new (`CheckForUpdateProcedure`: `failedLaunchCount`). The next manifest request carries `Expo-Recent-Failed-Update-IDs`; the server logs it. | expo-updates; route logs |
| 8 | Bad update crashes after first render, or is wrong without crashing | use | Not rolled back automatically (by design in `ErrorRecovery.swift`). Fix: deploy a fix, or `workoffdesk rollback` (works because of change 3). | release activation stamp |
| 9 | Signed out | after sign-out | JS clears the override → next cold start uses the build-time URL, `hasEmbeddedUpdate` is true again, launcher picks the embedded update (server's cached updates do not match URL/scope). Current JS keeps running until then. | `UpdatesConfig.getHasEmbeddedUpdate`; launcher URL filter |
| 10 | Server unreachable | cold start | No network at launch (`ON_ERROR_RECOVERY` does not check on a normal launch); launcher picks the newest cached update for this runtime + URL, or embedded via emergency launch. No splash wait. | config |
| 11 | Server unreachable | foreground check | Check fails, nothing changes; retried on a later foreground | JS |
| 12 | Switching servers | sign in to B after A | Override URL changes; A's updates fail the URL filter and live in another scope (`scopeKey` = URL origin) → not launchable. B's arrive by check. | launcher URL filter + scope |
| 13 | Token revoked / re-sign-in | any | Headers are `{}` and do not contain the token, so cached updates stay valid | change 1 |
| 14 | TestFlight upgrade, new runtime | first launch of new binary | Override persists in `UserDefaults`; no cached update for the new runtime → embedded (emergency launch) until the server offers that runtime | launcher runtime filter |
| 15 | TestFlight upgrade, same runtime (build-number-only build) | first launch | Cached server update still launches; the binary's newer embedded JS does not. Intended (corollary). | change 2 |
| 16 | `workoffdesk rollback`, or a deploy that fails health and switches back | after phones took the newer JS | The re-activated release gets a newer `createdAt` and a new id → phones load it | change 3 |
| 17 | Server restarts without a deploy | any | Same release, same activation stamp → same id → nothing to load | id derived from (bundle hash, runtime, createdAt) |
| 18 | Update applied mid-message | reload | We never call `reloadAsync` while the app is in front. Applied at cold start, or on returning to the foreground after ≥ 60 s in the background. Drafts are already kept in storage (`createDrafts(storage)`). | JS |
| 19 | Attacker: MITM on the transport | check/download | OTA is enabled only for `https://` servers (and `http://localhost`/`127.0.0.1`, the server's own `LOCAL` rule in `apps/server/src/config.ts`). Assets are additionally hash-checked against the manifest. | JS rule; TLS |
| 20 | Attacker: another host | any | The update URL is always `<signed-in server>/api/app-update/manifest`, set by our JS from `auth.current().server`; nothing in a response can change it. The `expo-server-defined-headers` / `expo-manifest-filters` response headers are never sent by us and are stored per scope. | JS |
| 21 | Attacker: path traversal on the asset route | download | Only file names listed in `update.json` are served | route (T6) |
| 22 | Attacker: the signed-in server itself is malicious | any | Out of scope: it already runs Claude Code on the user's Mac and holds the token. | — |

**Must stay allowed**

- Running the embedded JS when signed out, offline, on a server without this feature, or when the server
  has nothing for this runtime.
- Running a cached update with no network at launch.
- Moving to the server's older JS for the same runtime (rows 1, 16).
- Staying on the current JS when a check fails.
- Downloading in the background while the user types; applying only at a safe moment.
- Development (`expo start`, debug builds): `Updates.isEnabled` is false there; our JS does nothing.
- A server built without an app update (run from source, tests): answers `204`, never `500`.
- The web app (PWA) is untouched.

## 3. Who already knows each fact

| Fact | Who knows it | So |
|---|---|---|
| The app's native runtime | the binary: `EXUpdates.bundle/fingerprint`, written by expo-updates' Xcode build phase (`scripts/create-updates-resources-ios.sh` → `createFingerprintForBuildAsync`), sent as `Expo-Runtime-Version` | server compares to its own; no app-side copy |
| The runtime a server build serves | `expo-updates fingerprint:generate --platform ios` at server build time, same function as the build phase (`utils/src/createFingerprintAsync.ts`) | stored once in `update.json`; the release script asserts both computations agree |
| Which update is running, which failed, what is pending | expo-updates' SQLite and `useUpdates()` | JS reads `useUpdates()`; we keep no "last update" state |
| Which server to fetch from | `auth.current().server` (`apps/mobile/src/client.ts`) | override URL derived from it on every sign-in/out; not stored by us |
| Server version | `package.json` → `VERSION` (`apps/server/src/version.ts`), on `/healthz` | not copied into the manifest; ordering uses `createdAt`, not versions |
| When a release became current | `switchTo` in `apps/server/src/release.ts` | write `<release>/.activated` there; the route reads it, falls back to build time |
| Asset content identity | Metro names exported assets by content hash (`metadata.json` paths `assets/<hash>`) | that hash is the asset `key`; the bundle's key is its sha256 |
| The app config the JS sees (`Constants.expoConfig`) | `expo config --type public` at build time | becomes `extra.expoClient`; expo-constants reads it only from there for a downloaded update (`expo-constants/src/Constants.ts` `expoConfig` getter) |
| Public address scheme rule | `LOCAL` in `apps/server/src/config.ts` (https, or http on localhost) | asset URLs use `https://<Host>` unless Host is localhost/127.0.0.1 |

## 4. Layers

### Server route — `apps/server/src/routes/appUpdate.ts`, public

`GET /api/app-update/manifest` and `GET /api/app-update/assets/:file`, both `PUBLIC` (reasons: change 1).
Under `/api/` so the manifest gets `cache-control: no-store` from `app.ts`; this matters because the iOS
client uses `URLSessionConfiguration.default`, which honors HTTP caching (`FileDownloader.swift`).

What the iOS client sends with the manifest request (`FileDownloader.setManifestHTTPHeaderFields`):
`Accept: multipart/mixed,application/expo+json,application/json`, `Expo-Platform: ios`,
`Expo-Protocol-Version: 1`, `Expo-API-Version: 1`, `Expo-Updates-Environment: BARE`, `EAS-Client-ID`,
`Expo-JSON-Error: true`, `Expo-Runtime-Version`, and when present `Expo-Current-Update-ID`,
`Expo-Embedded-Update-ID`, `Expo-Recent-Failed-Update-IDs` (structured-field list), `Expo-Fatal-Error`
(≤ 1024 chars), plus the override's request headers (ours: none).

What it accepts (`FileDownloader.parseManifestResponse`):

- **No update:** `204` with `expo-protocol-version: 1`. Without that header a 204 is an error.
- **Update:** `200`, any non-`multipart/` content type → body parsed as the manifest. We send
  `application/json` (multipart only adds directives, and `rollBackToEmbedded` is meaningless here because
  `hasEmbeddedUpdate` is false under the override). `expo-protocol-version: 1` is **required**: without it
  `Update.update` throws `legacyManifestInstantiationInvalid`. Also send `expo-sfv-version: 0`.
- Manifest: `id` (UUID), `createdAt` (ISO 8601), `runtimeVersion`, `launchAsset {key, hash, url,
  contentType: application/javascript}`, `assets [{key, hash, url, fileExtension, contentType}]`
  (`fileExtension` required, with the dot), `metadata: {}` (required by expo-constants to recognize the
  manifest: `'metadata' in manifest`), `extra: { expoClient }`.
- `hash` = base64url(sha256(bytes)) without padding (`UpdatesUtils.base64UrlEncodedSHA256WithData`).
- `key` + extension is the file name on the phone; it must not contain `/`, `\` or NUL (`isSafeFilename`).
- Any non-2xx → error to the JS check. Assets get `Accept: */*` and maybe `A-IM: bsdiff`; we ignore
  `A-IM` and send the full file (we also turn bsdiff off in the app config).

Decisions:

- Runtime ≠ ours, platform ≠ `ios`, or no update in this build → `204`. Missing `Expo-Runtime-Version`
  or `Expo-Protocol-Version` ≠ `1` → `400`.
- `id` = UUID built from sha256(runtime ‖ launch-asset hash ‖ createdAt): stable across restarts, new on
  every activation.
- `createdAt` = `<release>/.activated` if present, else `update.json`'s `builtAt`.
- Asset URL base: `https://<Host>`, or `http://<Host>` when Host is `localhost`/`127.0.0.1` (the server's
  own rule). Missing Host → `400`. (Fallback if probe P7 fails: the phone passes its base as a query.)
- Assets: served only if the name is listed in `update.json`; `cache-control: public, max-age=31536000,
  immutable`; content type from the listing.
- `Expo-Recent-Failed-Update-IDs` containing our current id → one `warn` log line per id per process.
- `update.json` is read once at startup; its absence is logged once at `info`.

### Server build step

`apps/server` `build` gains a last step, `node scripts/build-app-update.mjs`:

1. `expo export --platform ios --output-dir <tmp>` in `apps/mobile` (Hermes bytecode on). Output
   (`@expo/cli` `exportApp.js`, `createMetadataJson.js`): `metadata.json`
   `{version: 0, bundler: "metro", fileMetadata: {ios: {bundle: "<path of the .hbc>", assets: [{path:
   "assets/<hash>", ext}]}}}`, the bundle under `_expo/static/js/ios/`, assets under `assets/`.
2. `expo-updates fingerprint:generate --platform ios` → `.hash` = runtime.
3. `expo config --type public --json` → `expoClient`.
4. `writeAppUpdate(exportDir, outDir, {runtime, expoClient, builtAt})` (a tested function compiled into
   `dist/server`): copies bundle and assets to `dist/app-update/ios/`, computes sha256, writes
   `update.json` **last**: `{runtimeVersion, builtAt, expoClient, launchAsset: {file, key, hash},
   assets: [{file, key, hash, fileExtension, contentType}]}`.

Any failure fails the build: a server without its app's JS would silently freeze the phones on old JS.
It ships in the npm package too (`files: ["dist", ...]`); binaries from other app builds have other
fingerprints and get `204`.

### Mobile config

See section 5. Key points, each read from source:

- `updates.url` must be set or expo-updates disables itself (`AppController` `InvalidMissingURL`), and
  then `setUpdateURLAndRequestHeadersOverride` throws. We set a placeholder that never resolves.
- `disableAntiBrickingMeasures: true` is required for the URL override
  (`EnabledAppController.setUpdateURLAndRequestHeadersOverride`). What it does: while an override is set,
  `hasEmbeddedUpdate` is forced false (`UpdatesConfig.getHasEmbeddedUpdate`), so the embedded update is
  not launchable and not compared by `createdAt`. If nothing cached matches, startup ends in an
  **emergency launch** of the embedded bundle (`StartupProcedure.emergencyLaunch` →
  `AppLauncherNoDatabase`), so it cannot brick; `Updates.isEmergencyLaunch` is true and an error line is
  written to `expo-error.log` (sent once as `Expo-Fatal-Error`). Risk it accepts: the binary's own JS never
  "wins" over the server's for the same runtime. That is our corollary, so we want it.
- The override persists in `UserDefaults` (`dev.expo.updates.updatesConfigOverride`) across launches and
  app upgrades, and applies to the running controller at once (`self.config = ...`).
- `checkAutomatically: ON_ERROR_RECOVERY`: no request on a normal launch (no splash wait), but a crash
  before first render asks the server for a fix for 5 s (`ErrorRecovery.waitForRemoteLoaderToFinish`).
  With `ON_LOAD` and nothing cached, launch would block on the network for up to 60 s
  (`FileDownloader.DefaultTimeoutInterval`).

### Mobile JS — `apps/mobile/src/appUpdate.ts`, mounted once in `_layout.tsx`

- If `!Updates.isEnabled` → do nothing.
- `auth.subscribe`: signed in to an allowed server (row 19) → `setUpdateURLAndRequestHeadersOverride({
  updateUrl: server + '/api/app-update/manifest', requestHeaders: {} })`; signed out or not allowed → `null`.
  Same call at startup for the kept login (idempotent).
- **When to check:** right after sign-in; at startup when signed in; on `AppState` → `active` if the last
  check was ≥ 15 min ago. `checkForUpdateAsync()`; if available, `fetchUpdateAsync()` at once (download in
  the background). Errors are ignored. No polling while in front.
- **When to apply:** cold start does it by itself (launcher picks the newest ready update). Additionally,
  if `useUpdates().isUpdatePending` and the app returns to the foreground after ≥ 60 s in the background,
  `reloadAsync()` in that `AppState` handler, before the user can touch anything. Never while in front.
- Optional (step 9): when the server reports a different app runtime, Settings shows "This app needs the
  new TestFlight build to get updates from this server" (en/zh in `@workoffdesk/i18n`).

### Release script — `apps/mobile/scripts/release-ios.sh`

After `archive`: read `EXUpdates.bundle/fingerprint` from the `.xcarchive` and compare to
`npx expo-updates fingerprint:generate --platform ios` run at the same commit. Different → fail before
upload, printing both. Print the runtime on success. This pins the assumption the whole design rests on.

**Releasing a TestFlight build (rows 14 and 15 above, seen on the simulator 2026-10-05).** While signed in,
the URL override turns `hasEmbeddedUpdate` off (`UpdatesConfig.getHasEmbeddedUpdate`: anti-bricking off +
override), so a binary's embedded JS is never picked over the server's:

- Same runtime: the phone keeps launching the update it last took from its server. Deploy the server built
  from the same commit with or before the upload, or the new build's JS changes reach no one.
- New runtime, or a server with no update for it: the launcher finds nothing under the server's scope,
  and expo-updates falls back to the binary's own JS (`StartupProcedure.emergencyLaunch`), logging
  "ErrorRecovery fatal exception: No launchable updates found in database". Harmless: nothing is deleted
  and checks go on; the first start after the server offers that runtime is a normal one.
- In the server log, `app update check` with `running: null` is a phone in that fallback.

The same note heads `release-ios.sh`.

### CLI — `workoffdesk`

- `deploy`: the success message adds the app update line (runtime, first 8 chars; or "none in this build").
- `release.ts` `switchTo`: write `<release>/.activated` (ISO time) before restarting.
- `scripts/smoke.mjs`: fetch the manifest with the build's runtime, then every asset URL, and check each
  sha256. A build whose app update is broken is never switched to.

### A JS fix without a server deploy

Not worth having. A server deploy is already the cheap path (copy, smoke, health check, automatic
switch-back), and a second channel is the app/server drift this design removes. Testing OTA during
development uses a throwaway server (a free port, its own home) built from the branch, with a Release
build on the device signed in to it — the same harness as the probes below.

## 5. App config and native deps (the last TestFlight build)

`npx expo install expo-updates` (→ ~57.0.24; brings expo-manifests, expo-structured-headers,
expo-eas-client, expo-updates-interface). `app.json`:

```json
"runtimeVersion": { "policy": "fingerprint" },
"updates": {
  "url": "https://workoffdesk.invalid/api/app-update/manifest",
  "checkAutomatically": "ON_ERROR_RECOVERY",
  "fallbackToCacheTimeout": 0,
  "disableAntiBrickingMeasures": true,
  "enableBsdiffPatchSupport": false
},
"plugins": ["expo-updates", "...existing"]
```

`apps/mobile/fingerprint.config.js`:

```js
/** @type {import('expo/fingerprint').Config} */
module.exports = { sourceSkips: ['ExpoConfigVersions', 'PackageJsonScriptsAll'] };
```

`ExpoConfigVersions`: see change 2. `PackageJsonScriptsAll`: `scripts` do not reach the binary (a
postinstall that patches native code changes hashed `node_modules` dirs anyway), and the server build
adds scripts. `.gitignore` and the app config stay hashed (the safe direction: no update rather than a
crash). Bump `ios.buildNumber` to 10. Everything in this section must be in the same build: the
fingerprint covers it, and adding any of it later costs another TestFlight build.

Not included, decided: a fixed `EXUpdatesScopeKey` (would let the reaper clean a previous server's few MB
after switching; needs a custom config plugin, and switching servers is rare).

## 6. Server route tests, written first

`apps/server/tests/integration/routes/appUpdate.test.ts`, against `buildApp` with a fixture build dir
(a tiny bundle, two assets, `update.json` from `writeAppUpdate`). Each must be seen red first against a
route that returns `{}` with 200.

- **T1 contract**: with the exact header set from `FileDownloader.swift:460-467` and our runtime →
  `200`, `expo-protocol-version: 1`, `expo-sfv-version: 0`, `cache-control: no-store`, JSON whose keys are
  exactly `id, createdAt, runtimeVersion, launchAsset, assets, metadata, extra`; `id` a UUID;
  `createdAt` parses; `extra.expoClient` equals the fixture's; `metadata` is `{}`.
- **T2 runtime**, parametrized: older, newer, empty, differs only in case → `204` with
  `expo-protocol-version: 1` and no body.
- **T3 bad request**, parametrized: no runtime header → 400; protocol `0`, `2`, missing → 400;
  platform `android`, missing → 204.
- **T4 public**: no `authorization` → 200; a bearer that is not a login → 200 (not 401); and a
  precondition: a guarded route (e.g. `GET /api/claude/projects`) with no login is still 401, so the guard is alive.
- **T5 hashes round-trip**: for the launch asset and every asset, GET its URL; base64url sha256 of the body
  equals `hash`. Plus a known vector: hash of the empty file is `47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU`.
- **T6 asset route**: unlisted name, `..%2Fupdate.json`, `update.json` itself → 404; listed → 200 with
  `immutable` cache header and the listed content type.
- **T7 incomplete build**: no `update.json` → 204; `update.json` listing a missing file → 204 (never an
  update whose asset would 404); malformed `update.json` → 204 and one error log.
- **T8 asset URL base**, parametrized Host: `mac.tail.ts.net` → `https://mac.tail.ts.net/...`;
  `192.168.1.5:7681` → `https://...`; `localhost:7681`, `127.0.0.1:7681` → `http://...`; missing → 400.
- **T9 id**: same build, two requests and two `buildApp` instances → same id; change `.activated` →
  different id and later `createdAt`; change the bundle → different id.
- **T10 failed ids**: `Expo-Recent-Failed-Update-IDs: "<our id>"` twice → one warn line with the id;
  another id → no line.
- **T11 key safety**: every `key + fileExtension` passes the client's `isSafeFilename` rule (port of it).

Plus unit tests for `writeAppUpdate` (`tests/unit/app-update-build.test.ts`): extension with dot;
key = Metro hash for assets, sha256 for the bundle; `update.json` written after all files (spy on
writes); missing `fileMetadata.ios` → throws. And one for `switchTo` writing `.activated` in
`tests/unit/release.test.ts`. Mobile tests come at the end of the mobile work, per the apps/mobile
practice.


## 7. Implementation plan

1. **Probe P1 first** (fingerprint agreement, below). If it fails, stop and revisit change 2.
2. Server, inert: `writeAppUpdate` + its tests; the route + T1–T11; mounted in `app.ts`. With no
   `update.json` it answers 204, so it can be merged and deployed before any app change.
3. Server: `.activated` in `switchTo` + test; `deploy` message; smoke step.
4. Build wiring: `scripts/build-app-update.mjs` in the server `build`. Check `pnpm build` time and the
   size of `dist/app-update` (P5).
5. Mobile, one PR: `expo-updates`, `app.json`, `fingerprint.config.js`, `appUpdate.ts`, release-script
   assertion, build number 10. Lint + typecheck; mobile tests at the end.
6. Device probes P2–P4, P6–P8 against a throwaway server from the branch.
7. Merge, run `release-ios.sh` (a TestFlight upload), then deploy the server. From then on, JS-only changes
   ship with `workoffdesk deploy`.
8. First real OTA: a visible one-line JS change, deployed; confirm on the phone and in the server log.
9. Optional: `/healthz` adds `app: { ios: <runtime> }`; Settings shows the mismatch notice.

## 8. Open risks and the probes that settle them

| | Risk | Probe |
|---|---|---|
| P1 | Server-build fingerprint ≠ the one in the binary (different worktree, `ios/` present or not, pnpm path names, VCS detection of the `managed` workflow) | In two worktrees, one with `ios/` from prebuild and one without, run `expo-updates fingerprint:generate --platform ios`; compare with `EXUpdates.bundle/fingerprint` in a Release archive. Must be one value. (Note: running `@expo/fingerprint` directly is **not** the same — on 2026-10-05 it hashed `ios/` as `bareNativeDir`; expo-updates passes `ignorePaths: ios/**` for the managed workflow.) |
| P2 | Emergency launch path: blank screen, delay, or `Constants.expoConfig` wrong (`USER_AGENT` in `client.ts` reads its `version`) | Fresh install, sign in, kill, airplane mode, relaunch: embedded JS runs at once; `isEmergencyLaunch` true; settings shows the right version |
| P3 | Override not effective for the next check in the same session | Sign in, check at once; server log shows the request |
| P4 | `reloadAsync` on foreground feels abrupt or loses state | Pending update, background 60 s, foreground: one reload screen, draft still there, session list back |
| P5 | `expo export` makes the server build slow or the npm package large | Time `pnpm build`; `du -sh dist/app-update` |
| P6 | Crash rollback does not behave as read | Deploy to the throwaway server a bundle that throws at import; device falls back; server log shows the failed id; the id is not loaded again |
| P7 | A proxy in front of the server rewrites `Host` | Fetch the manifest through the real front (e.g. Tailscale serve); asset URLs must name the host the phone used |
| P8 | `metro` asset hashing missing (no `metro.config.js` in `apps/mobile`) breaks the Xcode build phase | The first Release archive in step 5; it fails loudly if so |
| R1 | `disableAntiBrickingMeasures` is marked for preview builds in Expo's docs | Accepted: read the code paths above; P2 and P6 test the two that matter |
| R2 | A native change merged and deployed before its TestFlight build: phones on the old binary stop getting updates and talk to a newer server | Expected by design; step 9 makes it visible. The server should keep its API compatible with the previous app runtime for one release |
| R3 | Updates from a previous server stay on disk after switching (no fixed scope) | Accepted; a few MB, cleared when that server is signed in to again |
