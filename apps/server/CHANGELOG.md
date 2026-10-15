# Changelog

## 1.0.2

The release the iPhone app on the App Store needs: the app tells a Mac older than this to update.

- An iPhone app built for others to install takes its JS updates from one server named at build time, not
  from the server it is signed in to. The iPhone app can be tried on a Mac it simulates, without a server.
- Notifications for an iPhone app published for others go through its publisher's relay, sealed on the Mac
  for that one phone; the relay cannot read them. A server becomes a relay when `apns.json` names the app as
  `relayTopic`.
- Every conversation on the Mac is listed, and ended sessions are kept to read. The list can be grouped by
  project, and a session pinned to the top for every device.
- Swipe a row to end, delete or rename a session; a new name reaches Claude and Codex too.
- A session that hits its account's limit can move to another account, now or once free.
- The command Claude runs in the foreground can be sent to the background from the chat, and its background
  agents are listed. A sub-agent's work can be followed from the call that started it.
- A message is held while something is typed at Claude's prompt on the Mac, and a message taken back from
  Claude's queue on the Mac comes back here.
- Hold the empty box to talk; a picture pasted into the web composer is attached.
- The site can be reached at more than one address.
- The menu bar shows the app's mark, with a bar across it while sessions work.

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
