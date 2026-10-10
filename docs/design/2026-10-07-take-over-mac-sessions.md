# Taking over a Claude session from the Mac

2026-10-07. A Claude Code conversation started in a terminal on the Mac, outside WorkOffDesk, can be taken
over from the phone or the web: Claude quits in that terminal and the conversation goes on in a WorkOffDesk
session, which the Mac can attach to again (`workoffdesk attach <id>`). Claude Code 2.1.292.

## The one rule

One Claude process writes a conversation at a time. Resuming a conversation that is still open in a terminal
would give it two writers, each with its own idea of what came last; WorkOffDesk refuses that, or quits
the other writer first.

## How (all probed on 2.1.292)

- `claude agents --json` lists the Claude sessions running on the Mac: for each, its `pid`, `sessionId`,
  `cwd`, `kind` (`interactive`, or one of the background kinds) and `status`: `idle`, `busy` (a turn, or a
  shell it started, is running) or `waiting` (it asks the person something, such as a permission).
- A conversation can be open in more than one terminal at once (`claude --resume` twice); each is a writer.
- SIGTERM makes Claude quit as its own Ctrl-C does: it writes the rest of its transcript and exits in under
  a second, printing `claude --resume <id>`. What it was writing in a turn is lost; what the person sent
  stays. A permission prompt it showed comes back as an interrupted turn on resume.
- Resumed with `claude --resume <id>`, the conversation keeps its model. The flags the terminal's Claude was
  started with are not carried over; the session gets WorkOffDesk's own Claude arguments.
- A Claude in a WorkOffDesk session has `WORKOFFDESK_SESSION` in its environment (`ps -E`), whichever Work Off
  Desk on the Mac started it: one in a second, test install's session is not open on the Mac either, and must
  not be taken over by the first.

## The server

- `Machine.openOnMac()`: the interactive Claudes in no WorkOffDesk session, grouped by conversation;
  a conversation's status is its busiest Claude's (waiting, then busy, then idle).
- `Machine.createSession` with a Claude `resumeId` guards the rule for every caller:
  - already open in WorkOffDesk: that session is returned;
  - open on the Mac, without `takeOver`: 409 `open-on-mac`, naming the terminals;
  - with `takeOver`: every Claude on it is sent SIGTERM and waited on for up to 10 s; when one is still
    running, 409 `mac-would-not-quit` and nothing is started (it is not killed harder). Each terminal left
    is told where the conversation went and how to attach to it;
  - asked again while a resume of the same conversation runs, the same session is returned.
- `takeOver: 'whenIdle'` on `POST /api/m/local/sessions`: when the conversation is busy or waiting on the
  Mac, the answer is 202 `{ waiting: true }` and the Mac is looked at every 2 s; once every Claude on it is
  idle or gone, it is taken over as above. It waits 12 hours at most.
  `DELETE /api/claude/sessions/:sid/take-over` stops waiting; a take-over now stops it too.
- `GET /api/claude/recent` gives each conversation `onMac` (`{ status, terminals }` or null), `takingOver`
  (waited on, or being taken over now), and `lastPrompt`: what the person last asked, which tells two
  conversations apart better than Claude's title made from the first message.

## The apps

- The Mac's conversations list shows, per row, the last prompt, the folder, and whether it is open on the Mac:
  at work, waiting for the person, or open in more than one terminal. It is asked again every 15 s while in
  front; a periodic answer keeps the order shown, so a row does not move under a finger.
- A conversation's page offers what fits its state, and is asked again every 3 s while it is open on the Mac:
  - idle: take over;
  - busy: take over when this step is done, or now, stopping the step;
  - waiting for the person: take over now, saying its question is dropped;
  - waiting to take over: take over now, or cancel; it goes to the session once it opens, or says it did not.
- A session's menu has "Continue on the Mac": the `workoffdesk attach <id>` command, to copy.
- The list ends with a hint: a Claude started in a WorkOffDesk session needs no taking over.

## Not done

- A Claude whose conversation is taken over between its going idle and its quitting (about a second) loses a
  turn the person starts on the Mac in that time; the message itself stays in the conversation.
- Codex threads on the Mac: listed and taken over since 2026-10-08-codex-on-the-mac.md.
