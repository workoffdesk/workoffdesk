# The menu bar icon shows when sessions are working

The menu bar app's icon is the app's mark, drawn in one colour as a template image: a phone, and a laptop
whose screen is a chat bubble. While any session on the Mac is working, a bar runs across the bubble, as on
the app icon. The service in trouble or stopped keeps the system's symbols for those states.

## What must hold

The bar shows exactly while the service runs and at least one of its sessions is working, and within a
second of that changing. Working means the status `working` or `compacting`; `waiting` (the session needs
you), `idle`, `starting` and `ended` are not.

## Ways it could break

| How | Then |
| --- | --- |
| A turn starts or ends, a compact starts or ends | the bar follows within a second |
| A working session is killed or ends | it stops counting |
| The app starts while sessions are working | the first answer says so, without waiting for a change |
| Many changes in a burst | a line only when the count changes |
| The service stops, restarts or is deployed | the stream ends, the bar goes, and the app asks again until it answers |
| The CLI is not installed, or the service never ran | no bar; the existing question mark or stop symbol |
| The CLI prints a line the app cannot read | it is skipped; the count stands |

## Who knows

The server: each session's status is in `MachineState.statuses`, and every change to it emits to the
machine's listeners. The count is computed there and nowhere else; the CLI only carries it and the app only
draws it.

## Pieces

- `Machine.working()`: how many of the sessions the store has are working.
- The control socket's `GET /activity`: `{"working":N}` and a newline at once, then one each time the count
  changes, until the client goes away. Each stream also checks the count every two seconds, which catches a
  change that emitted nothing.
- `workoffdesk activity`: prints those lines as they come; exits when the server ends the stream, with the
  not-running message when there is no server, and on its own once the app that ran it is gone.
- The Mac app's `ActivityWatch` (WorkOffDeskKit): runs `workoffdesk activity`, reads its lines, and reports
  each count; when the process ends it reports 0 and runs it again five seconds later, twice as late each
  time a run answered nothing (a stopped service, an older CLI or server), up to a minute. A run that
  answered and ended has the app ask the status again at once. The app stops it when it quits.
- `Model.mark`: `.plain` or `.working` while the service is fine, else the system symbol it had before.
  `MenuBarMark` draws the mark as a template `NSImage`, so the menu bar tints it.
