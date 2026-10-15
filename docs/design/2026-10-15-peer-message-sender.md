# Going to the session a message came from

A Claude session can be sent a message by another Claude session on the same Mac. The chat shows it as a
note, "Message from <name>", which opens to the message. There is no way from there to the session that sent it:
the name is all the note says, and the person has to find that session by hand, on the Mac or in the list.

## What holds

A message from another session leads to that session's conversation, for as long as the session that sent it is
running on the Mac.

## What Claude Code records

The transcript record of such a message carries an `origin`:

```json
{ "kind": "peer", "name": "Docs", "verifiedPeerPid": 73750, "from": "uds:/tmp/cc-socks/73750.sock", "body": "…" }
```

`verifiedPeerPid` is the sender's process, checked by Claude Code. `name` is the name the sender goes by and need
not be unique. `claude agents --json` lists every running Claude with its `pid`, `sessionId` and `name`, one listing
per Claude account.

## Design

- The server reads `verifiedPeerPid` into the note: `{ e: 'peer', from, pid }`. A record without one (an older
  Claude Code) gives a note with no `pid`, which offers nothing more than it does now.
- `GET /api/claude/peers/:pid?name=` answers `{ sid, openIn }`: the sender's conversation and the session here
  that holds it, if any. It looks in the Mac's listing of running Claudes, those workoffdesk runs included, since a
  session here can be the sender. The pid must be listed and, when the listing gives a name, under the name the
  note gives, so that a pid reused by another Claude does not lead to the wrong conversation. Otherwise it answers
  404 with the code `peer-gone`. It asks the Mac afresh, since it is asked once, on a press, and a listing made
  before the sender started would not have it; when the Mac does not answer in time it says so (409
  `mac-unanswered`) rather than that the sender is gone.
- The web and the app put "Go to that session" under the message in the opened note. It goes to the session here
  when one holds the conversation, else to the conversation's page for the Mac, which offers what can be done with
  it (read it, go on with it here, take it over). When the sender is gone it says so: "The session that sent
  this is no longer running on the Mac."

## Not in this

- Teammate messages Claude Code puts in one envelope carry no pid and stay as they are.
- A message whose sender has quit cannot be followed: the transcript does not record the sender's session id.

## Tests

- Server, unit: the note carries `pid` from `verifiedPeerPid`, and none for a record without it or with a
  non-integer one.
- Server, integration: the listing keeps the name and those workoffdesk runs; the views of the Mac's terminals
  still leave out the latter; asked at once for both, the Mac is listed once.
- Server, integration: the route answers the sid and the session holding it, and none for a session here that
  has ended; 404 `peer-gone` for a pid not listed, gone, or listed under another name; 409 `mac-unanswered` when
  the listing hangs; 400 for a pid that is not a number.
- e2e: opening the note and pressing the button goes to the session here holding the sender's conversation; for a
  sender that is gone, the message is shown.
