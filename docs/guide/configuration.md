# Configuration

English · [简体中文](configuration.zh-CN.md)

## Where things are

Everything lives in `~/.workoffdesk`, created readable by you only. Set `WORKOFFDESK_HOME` to put it
elsewhere, for the commands and the service alike.

| Path | What |
|---|---|
| `config.json` | The settings below |
| `state.json` | The user, passkeys, signed-in devices and push subscriptions |
| `apns.json` | The iPhone app's push key, if you use the app |
| `journal.db` | The sessions' journal, including messages waiting to go to Claude |
| `uploads/` | What the phone sent, deleted after 30 days |
| `logs/` | See [Troubleshooting](troubleshooting.md) |
| `releases/`, `app` | Builds installed with `deploy`, see [Upgrade](upgrade.md) |

## config.json

`setup` writes it. The service checks it at start, and a wrong field stops it with that field's name. Restart
the service after changing it.

| Field | Default | Meaning |
|---|---|---|
| `origin` | — (required) | The address the phone opens, like `https://workoffdesk.example.com`. `http://localhost:<port>` for this Mac only. |
| `extraOrigins` | `[]` | Other `https://` addresses the same service is reached at, like a second tunnel or your own server: `["https://other.example.com"]`. A browser signs in on each. A passkey works on the address it was made on, unless `rpId` is a domain above both. |
| `port` | `7681` | The port the service listens on, on `127.0.0.1`. |
| `rpId` | the origin's hostname | The passkey domain: the hostname or a domain above it. Changing it makes existing passkeys stop working. |
| `pinnedDirs` | `[]` | Folders always offered when starting a new Claude. |
| `claudeArgs` | `[]` | Extra arguments for every `claude` it starts, like `["--chrome"]`. Read [SECURITY.md](../../SECURITY.md) before adding `--dangerously-skip-permissions`. |
| `preventSleep` | `true` | Keep the Mac from idle sleep while the service runs. |
| `serviceLabel` | `local.workoffdesk` | The launchd label; the tunnel's is this plus `-tunnel`. Run `install` again after changing it. |

## Sleep

While the service runs it holds a `caffeinate -i` assertion, so the Mac does not idle-sleep and stays
reachable. The display still turns off, and closing the lid of a laptop still puts it to sleep. The assertion
ends with the service.

To let the Mac sleep, set `"preventSleep": false` and restart the service. The phone then cannot reach the Mac
while it sleeps, and `doctor` reports it.

## iPhone app notifications

The iPhone app is notified through Apple's push service, which needs a key of the Apple Developer team that
signs the app. Web push needs nothing of the kind.

1. In your Apple Developer account: Keys → + → Apple Push Notifications service (APNs). Download
   `AuthKey_<keyId>.p8`.
2. Write `~/.workoffdesk/apns.json`:

   ```json
   { "teamId": "<Team ID>", "keyId": "<keyId>", "keyFile": "/Users/you/.workoffdesk/AuthKey_<keyId>.p8" }
   ```

3. Restart the service, and check with `workoffdesk doctor`.

Each device is tried on Apple's production service first (TestFlight and App Store builds), then on the
sandbox (builds from Xcode), and remembered on the one that answered.

## Restarting the service

```bash
launchctl kickstart -k gui/$(id -u)/local.workoffdesk
```

Sessions keep running through a restart.
