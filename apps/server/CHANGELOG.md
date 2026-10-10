# Changelog

## 1.0.1

The first release published from GitHub Actions, with npm provenance.

- A session that ends just as the phone opens it now closes on the phone, instead of staying open on nothing.

## 1.0.0

The first public release.

- Chat with the Claude Code sessions on your Mac from your phone, in a web app you can add to the home
  screen. The interface is in English or Chinese, following the phone.
- Claude's questions, permission prompts and panels such as `/usage` become cards you answer with a tap.
- Sessions run in tmux on the Mac and outlive the phone; `workoffdesk attach` joins one from the Mac's
  terminal.
- One user per install, with a password and passkeys; sign-ins can be revoked device by device.
- Web push when Claude waits for you or finishes a turn.
- `install.sh` installs the dependencies and the npm package; `workoffdesk install` runs the service under
  launchd; `workoffdesk deploy` and `rollback` upgrade it and switch back when the new version does not start.
- `workoffdesk doctor` checks tmux, Claude Code, the service, the address, idle sleep and the push key, and says
  what to do about each problem. `setup` and `doctor` print the address as a QR code.
- While the service runs, the Mac does not go to idle sleep.
- `workoffdesk --version`.
- An iPhone app you build with your own Apple Developer account, with notifications through APNs. It keeps
  every account you sign in to, and you move between them from Settings.
