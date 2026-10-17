# Newest first, and a bounded copy on the phone

2026-10-17.

## What goes wrong

**A long session walks forward.** A copy that is far behind the Mac catches up a page at a time, oldest first, and the
page draws each one as it comes. Several cases leave a copy far behind:

- a copy kept on the phone, of a session that went on for hours on the Mac;
- a session taken over from the Mac, whose whole transcript is taken in at once;
- a session that moved to a new conversation.

The person sees the chat load a stretch at a time "up to now", instead of the newest turns at once.

**The phone keeps everything it was ever shown.** The copy of a Mac conversation read before picking it up
(`apps/mobile/src/chatStore.ts`) is never dropped. Every conversation opened stays, up to 1500 items each, until the
phone signs out. The journal copy (`apps/mobile/src/journalStore.ts`) drops a session idle for 30 days, but keeps
every item of one in use, although it only ever reads back the newest 1500. There is no way to see or clear either.

## What must hold

1. **One answer from the Mac leaves the copy at the Mac's newest turn.** A copy more than one page behind starts
   over from the newest page; the turns before it come a page at a time when scrolled to, as they do for a copy
   opened for the first time.
2. **The phone's copies are bounded, and clearing them costs nothing but a slower first open.** Everything in them
   is read again from the Mac.

## Paths that broke 1, and what each does now

| Path | Before | Now |
|---|---|---|
| A copy asks for the journal, more than a page (500 rows) behind (`Journal.sync`) | pages of 500 rows, oldest first, asked for one after another | the answer starts over: every message and state, the newest 100 items, `reset` |
| The line catches a copy up (`sessionSocket.ts` `catchUp`) | the same pages, pushed one after another | the same single answer |
| More than a page written at once while a copy listens (`Journal.tell`: a takeover, a new conversation) | pushed in pages of 500 | one push that starts over |
| A Claude conversation read before picking it up, more than one read (4 MB) behind (`readChat`) | 4 MB forward a poll, oldest first | its newest turns, which the copy takes as a start over (`applyChat`) |
| A Codex thread read before picking it up, more than a page behind | everything since, in one answer | its newest page |

What still holds:

- **Small gaps.** A gap of a page or less goes on where the copy is, so nothing on screen moves.
- **Messages on their way.** These survive a start over: `applyRows` keeps those still sending.
- **Older clients.** Every client already takes a start over, so there is nothing new on the wire.
- **Older servers.** A client still asks again while an answer says `more`, so it keeps working with a server that
  pages.

## Bounds, and clearing

- **Journal copy.** When the file opens, it still drops a session idle for 30 days. It now also drops the items of
  conversations other than the one each session shows. Of that one it keeps only the newest 1501 items: the 1500
  read back, and one to say there are more.
- **Copy of a Mac conversation.** On the phone it moves from the key-value store to a table of its own, with when
  each was last shown. When the file opens, a conversation not shown for 30 days goes, and so does any past the
  50 shown last. The old key-value file is deleted.
- **The web app's copy.** Its copy of a Mac conversation (IndexedDB) keeps the same bound, from the same rule
  (`libs/client/src/chat/kept.ts`).
- **Settings → Storage on the phone.** This shows how much the copies take. **Clear** deletes the files, for every
  Mac signed in to. It also forgets the copies held in memory: a copy in memory written on top of an emptied file
  would leave the file a copy that says it is up to date while missing turns.

Left out: clearing one conversation (the bound and the whole clear cover it), and writing the Mac conversation copy
in parts rather than whole.
