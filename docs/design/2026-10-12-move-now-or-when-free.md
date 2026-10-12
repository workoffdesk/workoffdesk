# Moving now, or once free; and quitting the copy on the Mac

2026-10-12. Follows [going on on another account, from the session that hit its limit](2026-10-12-move-this-session.md).

## What went wrong

- **A refusal with nothing to press.** Moving a session was refused while its Claude worked, or while a Claude in a
  terminal on the Mac holding the same conversation was at work or asking. The page said "let it stop there
  first" and left it at that. The copy on the Mac may never stop: one holding a background command reports itself
  at work for as long as that command runs.
- **The bar that says the conversation is open on the Mac too** asked to quit the Claude there by hand, from a
  terminal one may not be at.
- **Another account only after a limit.** The account picker opened only from a reply a limit stopped.

## The one rule

**Whoever asks to move a session, or to quit the copy of its conversation on the Mac, either has it done, or is
told why and offered both ways on: now, interrupting what runs, or once it is free, without asking again.**

## The server

`POST /api/m/:machine/sessions/:id/move` takes `{ when }`:

- none: as before. Refused with 409 `session-busy` or `open-on-mac-busy` when something is at work.
- `now`: what is at work is interrupted. The Claudes on the Mac holding the conversation are quit whatever they
  are doing, and the session's own Claude is quit mid-turn and started again on the account in use, going on with
  its conversation. Messages not yet taken in wait in the outbox and go once it runs again.
- `free`: the session is marked to move (`moving`, kept across a restart) and answered at once. It moves when its
  turn is over and no Claude on the Mac holding the conversation is at work. While one there is at work, it is
  looked at again every few seconds. A session started from a terminal moves this way too: it was asked for by name.

Moving a marked session now also quits the idle Claudes on the Mac holding its conversation first, as moving the one
session asked for does. That includes the sessions moved by **move the open sessions**.

`POST /api/m/:machine/sessions/:id/quit-on-mac` takes `{ force }`. It quits each Claude in a terminal on the Mac that
holds the session's conversation, and tells that terminal where the conversation went. It refuses with 409
`open-on-mac-busy` while one there is at work or asking, unless `force`. The bar is gone once they have quit: the
count of copies on the Mac is looked at again then.

## The page

- **The bar** has **Quit it on the Mac**. When the Claude there is at work, the page asks first, and quits it only
  when told to.
- **The account picker** opens from the session's menu too (**Switch Claude account**), for a Claude session with
  another account to go to. Opened from there, nothing is said once moved.
- **Refused for something at work**: under the reason, **Switch now** (interrupts it) and **Switch once it
  stops**. Once it stops, the picker closes and the session moves when it is free. Anything asked for is said once
  it runs on the new account, as before.

## Not in this

- Cancelling a move asked for once free: picking the account it runs on again leaves it where it is.
