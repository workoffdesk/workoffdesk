# iPhone app

English · [简体中文](ios-app.zh-CN.md)

## Do you need it?

Probably not. The web app, added to the home screen, does everything the app does, push notifications
included. The native app is for those who want it. A build of your own is signed by your team, and your Mac
sends its notifications with your team's key. A build someone publishes for others cannot have that key, so
its notifications go through the publisher's relay, sealed for your phone alone; see
[Publishing a build for others](#publishing-a-build-for-others).

## Try it without a Mac

The sign-in form has "Try the demo": the app on a Mac it simulates on the phone, with three made-up sessions in
the app's language. A message sent there is answered by a short scripted turn, and a reply can be stopped;
sessions can be started, ended, renamed and pinned. What needs a real Mac (pictures, files, voice, the terminal)
says it is not in the demo. Nothing goes over the network. "Connect my Mac" at the top of the list leaves it.

## What you need

- A paid Apple Developer account.
- Xcode, and this repository with its dependencies (`pnpm install`, see [CONTRIBUTING.md](../../CONTRIBUTING.md)).
- An App Store Connect API key with the Admin role, which automatic signing needs: App Store Connect → Users
  and Access → Integrations → App Store Connect API. Put the `.p8` file in
  `~/.appstoreconnect/private_keys/`.

## Choose its bundle id and team

```bash
export WORKOFFDESK_IOS_BUNDLE_ID=com.yourname.workoffdesk   # any id you own
export WORKOFFDESK_TEAM_ID=<your Team ID>                    # developer.apple.com → Membership
export ASC_KEY_ID=<key id> ASC_ISSUER_ID=<issuer id>
```

`apps/mobile/app.config.ts` reads the bundle id; without it the app is built as `com.example.workoffdesk`,
which you cannot sign.

## Build and install

```bash
cd apps/mobile
./scripts/release-ios.sh              # build, sign and upload to App Store Connect, then TestFlight
./scripts/release-ios.sh --no-upload  # or stop at the .ipa
```

The version and build number come from `app.config.ts`; raise `ios.buildNumber` before each upload. Once
App Store Connect has processed the build (5–15 minutes), install it from TestFlight.

## Notifications

Create an APNs key in the same team and name it in `~/.workoffdesk/apns.json`; see
[iPhone app notifications](configuration.md#iphone-app-notifications). Then open the app, sign in with your
server address, and turn notifications on in its Settings.

## Updates from your own Mac

The app takes JavaScript updates from the server it is signed in to, not from any store. A server only offers
them when it was built with the same `WORKOFFDESK_IOS_BUNDLE_ID`. From a clean checkout of this repository:

```bash
pnpm install --frozen-lockfile
WORKOFFDESK_IOS_BUNDLE_ID=com.yourname.workoffdesk pnpm --filter workoffdesk build
pnpm --filter workoffdesk deploy --prod --legacy ~/workoffdesk-build
workoffdesk deploy ~/workoffdesk-build
```

`workoffdesk deploy` needs the service to run from a build folder; see
[Upgrade](upgrade.md#upgrades-that-check-themselves). The npm package is built without it, so it
offers no updates, and the app runs the JavaScript it was built with. When a change needs new native code, the
app's runtime changes, and only a new build from TestFlight brings it. So does a change to the app's config,
its `package.json` among them. `workoffdesk deploy` refuses a build whose runtime is not the live one's, as
phones on that one would get no more updates; once a new build of the app is out, deploy it with
`--new-app-runtime`.

## Publishing a build for others

A build that people install without building it, such as one on the App Store, runs against Macs that are not
yours. Two settings, next to `WORKOFFDESK_IOS_BUNDLE_ID` when you build it, make it work, and neither changes
a build without them:

- `WORKOFFDESK_IOS_UPDATE_URL`: the one place its JavaScript updates come from, your server's
  `https://<your server>/api/app-update/manifest`. It never takes them from the Mac it is signed in to.
- `WORKOFFDESK_IOS_PUSH_RELAY`: the https origin of your server, which passes its notifications on to Apple.
  The build gets a notification extension. The phone makes a key, kept in its keychain, and gives it to each
  Mac it signs in to; the Mac seals each notification with it and sends it to the relay, which sees the
  device, the time and the size, never what it says. It needs `WORKOFFDESK_TEAM_ID`.

Your server relays only when its `apns.json` names the app's bundle id as `"relayTopic"` (see
[iPhone app notifications](configuration.md#iphone-app-notifications)), and then only for that app, at most 30
notifications a minute for a device. A Mac whose workoffdesk is older than the app's JavaScript needs gets a
screen in the app saying how to update it.
