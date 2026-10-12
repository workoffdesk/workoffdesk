# Going on on another account, from the session that hit its limit

2026-10-12. Follows [moving open sessions to another account](2026-10-09-move-sessions-to-account.md). A
session stopped on its account's limit offers **Move to another account and go on**. That button picked the
account and asked for every open session to move, then waited for this one to show up on the new account.

## What went wrong

- **A session taken over from a terminal never moved.** The move leaves such sessions alone (they run on their
  terminal's account), so nothing moved, the server answered as if all was well, and the page waited for good.
- **The conversation was open twice.** Another program on the Mac had resumed the same conversation in a
  terminal of its own, on another account. Moving the session here would still leave two Claudes writing it.
- **An ended session could not be gone on with.** Continue was refused as the conversation was open on the
  Mac; the page that offers to take it over saw the ended session here as the one it was open in, and offered
  only to open that, which led back to the ended session.
- Nothing said why: the page has no answer of its own to show.

## The one rule

**The session the button was pressed in either goes on on the account picked, as the only Claude writing its
conversation, or the page says at once why it did not.**

## The server

`POST /api/m/:machine/sessions/:id/move` (`Moves.moveThis`) moves that one session to the account in use, and
answers once it has, with the session:

- **Started from a terminal** too: it was asked for by name. Claude starts again as Continue starts it, on the
  account in use; the terminal's environment stays in its tmux session, so only the account changes.
- **Already on the account in use**: answered at once, nothing done.
- **Open in a terminal on the Mac** as well: each Claude there is quit first and told where the conversation
  went, as taking over does. One there at work or asking is not quit: 409 `open-on-mac-busy`. One that will
  not quit: 409 `mac-would-not-quit`.
- Refused with 409: before any account was picked (`account-none-picked`); while it is not at its prompt
  (`session-busy`); one whose Claude is not running, or whose folder is gone (`cannot-move`); a Claude here that
  would not quit (`move-failed`, with why).

The move of every other open session (`POST /api/claude/account/move`) is as it was.

The list of conversations on the Mac names, as the session one is open in (`openIn`), only a session whose
agent still runs. An ended one is gone on with by Continue, and when the conversation is open on the Mac, the
page offers to take it over.

## The page

**Move** picks the account, moves this session, then asks for the rest to move. When this session's move is
refused, the reason is shown under the accounts and the offer stays open. Once moved, what was asked for is said
as before, once the session runs on the account.

## Not in this

- Taking a conversation over from a terminal still keeps that terminal's account; the button moves it after.
