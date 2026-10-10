# Install

English · [简体中文](install.zh-CN.md)

## What you need

- A Mac. The service is a launchd agent, so it runs on macOS only.
- Node 22.13 or later, tmux 3.3 or later.
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code), as `claude` in `~/.local/bin` or on your `PATH`.
- A way to reach the Mac over HTTPS from your phone. See [Remote access](remote-access.md).

## The install script

```bash
curl -fsSL https://raw.githubusercontent.com/workoffdesk/workoffdesk/main/install.sh | bash
```

It stops unless it runs on macOS with [Homebrew](https://brew.sh). Then it:

1. installs tmux and Node with Homebrew, only if they are missing;
2. installs the `workoffdesk` npm package globally;
3. runs `workoffdesk doctor`;
4. run in a terminal on a Mac that is not set up yet, goes on to [the setup in the browser](#set-it-up-in-the-browser);
   otherwise prints the next steps.

It never uses `sudo`. If npm's global `bin` folder is not on your `PATH`, it says what to add to `~/.zprofile`.

## Without the script

```bash
brew install tmux node
npm i -g workoffdesk
```

## Set it up in the browser

```bash
workoffdesk setup --web
```

It opens a page on this Mac that takes you through the rest: what the Mac is missing, with the command for
each; the account; the address your phone will open (Tailscale's address when Tailscale runs, a Cloudflare
tunnel you have, or one you type); then it installs and starts the service and shows the address as a QR
code for the phone's camera. It does what the commands below do.

The page is served from `127.0.0.1` only, and only to the browser that opened the address it printed. It ends
when you click Finish, on Ctrl-C, or after 30 minutes unused.

## Set it up

```bash
workoffdesk setup --origin https://workoffdesk.example.com
```

`--origin` is the address your phone will open. `http://localhost:7681` works for trying it on the Mac only.
`setup` asks for a username and a password of at least 12 characters (or takes `--username`, and the
password on standard input), and writes `~/.workoffdesk/config.json`. When the address is HTTPS it prints it
as a QR code for the phone's camera.

Running `setup` again replaces the user and password and signs every device out; the rest of the config
stays unless you pass a new `--origin`.

To try it before installing the service:

```bash
workoffdesk serve      # http://127.0.0.1:7681 on this Mac
```

## Run it as a service

```bash
workoffdesk install
```

`install` writes `~/Library/LaunchAgents/local.workoffdesk.plist` and a `~/.local/bin/workoffdesk` command
that use the Node that ran it (`--node <path>` picks another). It starts nothing; it prints the commands
to run, the first being:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.workoffdesk.plist
```

or `workoffdesk start`, which also waits for the service to answer. From then on the service starts when
you log in. `workoffdesk stop` stops it until the next login or `start`; `workoffdesk restart` restarts it
without ending sessions. `install --tunnel <name>` also sets up a Cloudflare tunnel;
see [Remote access](remote-access.md).

## Check it

```bash
workoffdesk doctor
```

| Check | Passes when |
|---|---|
| `macos` | It runs on macOS. |
| `node` | Node is 22.13 or later. |
| `tmux` | tmux is 3.3 or later. |
| `claude` | Claude Code runs. |
| `codex` | Always: it says whether Codex is there, which is optional. |
| `setup` | `setup` has run and the config is valid. |
| `service` | The service answers on its port and runs the same version as the command. |
| `origin` | Your address reaches the service (an `http://localhost` address passes, for this Mac only). |
| `sleep` | The service keeps the Mac from idle sleep. |
| `apns` | There is no iPhone push key, or the one in `apns.json` can be read. |

Every ✗ comes with the command or change that fixes it, and `doctor` exits with 1 while anything fails.
When your HTTPS address reaches the service, it prints the QR code again.

## The menu bar app

`apps/mac` in the repository is a menu bar app for the Mac: its icon shows whether the service runs, has a
problem, or is stopped, and its menu shows the failed checks with their fixes (a click copies one), the newest
errors, Start, Stop and Restart, Open in Browser, the address as a QR code, Open Logs Folder and Open at Login.
With more than one Claude account, it also picks the account sessions run on and moves the open ones to it.
It reads everything from `workoffdesk status --json` and does everything with the `workoffdesk` command, so
it needs the service installed first. Build it with Xcode's command line tools:

```bash
apps/mac/scripts/build-app.sh      # makes apps/mac/build/WorkOffDesk.app
```

The app is signed for this Mac only; move it to `/Applications` and open it.

## Uninstall

```bash
launchctl bootout gui/$(id -u)/local.workoffdesk
rm ~/Library/LaunchAgents/local.workoffdesk.plist ~/.local/bin/workoffdesk
tmux -L workoffdesk kill-server     # ends every session it runs
npm rm -g workoffdesk
rm -rf ~/.workoffdesk               # config, sign-ins, uploads and logs
```

With a tunnel, also `launchctl bootout gui/$(id -u)/local.workoffdesk-tunnel` and remove
`~/Library/LaunchAgents/local.workoffdesk-tunnel.plist`.
