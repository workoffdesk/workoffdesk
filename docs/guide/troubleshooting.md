# Troubleshooting

English · [简体中文](troubleshooting.zh-CN.md)

## Start with doctor

```bash
workoffdesk doctor
```

It checks the Mac, the setup, the service, your address, sleep and the iPhone push key, and every ✗ says what
to do. Most problems end there. The same checks are on the phone under Settings → This Mac, with the
service's recent warnings and errors, and in the menu bar app.

## Logs

In `~/.workoffdesk/logs/`:

| File | What |
|---|---|
| `workoffdesk.log` | The server's own log, JSON lines, rotated at 10 MB with three kept |
| `server.log` | What launchd catches from the process; startup failures land here |
| `audit.log` | Sign-ins and failed attempts |
| `tunnel.log` | cloudflared's log, with a Cloudflare tunnel |

## Symptoms

| Symptom | Look at |
|---|---|
| The service does not start | `tail ~/.workoffdesk/logs/server.log`; `launchctl print gui/$(id -u)/local.workoffdesk` shows its state and last exit code |
| `config.json: <field> is wrong` | Fix that field, see [Configuration](configuration.md) |
| `No user is set up yet` | Run `workoffdesk setup` |
| The page does not open from the phone | `doctor`'s `origin` check; with a tunnel, `tunnel.log` and `cloudflared tunnel info <name>` |
| The page opens but sessions never connect | Your proxy must pass WebSockets, see [Remote access](remote-access.md) |
| The phone cannot reach the Mac after a while | The Mac went to sleep: `doctor`'s `sleep` check. Closing a laptop's lid still sleeps it |
| Chinese or other text shows as `_`, the list looks garbled | The locale is not UTF-8. The service sets `LANG=en_US.UTF-8`; check it if you edited the plist |
| Claude's status never changes | Hooks report over a socket in the service's home: see `workoffdesk.log`. `claude` must be in `~/.local/bin` or on the `PATH` |
| Locked out after failed sign-ins | Wait the minutes it says; attempts are in `audit.log` |
| The iPhone app gets no notifications | `doctor`'s `apns` check; see [iPhone app notifications](configuration.md#iphone-app-notifications) |
| Web push cannot be turned on | Open the site over HTTPS, from the icon added to the home screen |

## iPhone app cannot connect

- **To a Mac on the same Wi-Fi by its local address:** allow the app in Settings → Privacy & Security →
  Local Network.
- **On iPhones sold in mainland China:** Settings → Mobile Data (Wireless Data), find the app, and choose
  WLAN & Cellular. It may be set to Off or WLAN only.

## Reporting a problem

Open an [issue](https://github.com/workoffdesk/workoffdesk/issues/new/choose) with the output of
`workoffdesk --version` and `workoffdesk doctor`, and the lines around the problem from `workoffdesk.log`.
Read what you paste first: it holds your address and paths. Anything that lets someone in without the
password goes to a [private report](https://github.com/workoffdesk/workoffdesk/security/advisories/new) instead.
