# Pinned sessions

2026-10-12.

## What went wrong

The session list puts the one worked in last first. A session one keeps going back to moves each time another
does something, so it is never where it was a moment ago.

## The one rule

**A pinned session stays where it was put, at the top of the list, on every device, until it is unpinned.**

## The server

- A session's meta has `pinned`: when it was pinned, in ms; missing when it is not. The list says it as
  `pinned` too.
- `PUT /api/m/:machine/sessions/:id/pin` pins a session, running or ended; `DELETE` on the same path unpins it.
  Both answer 204, 404 for no such session, 400 for a bad id, and tell every device the list changed.
- Pinning a pinned session leaves its time as it was, so a request sent again does not move it.
- The pin stays with the session through its agent quitting, its being kept as past, and its being gone on with
  again (`revive` keeps it as it keeps the name). A shell session is dropped when it ends, and its pin with it.

## The list

`listView` (the list both apps show):

- Pinned sessions come first, with no heading, the one pinned last on top; their rows are drawn in a colour of
  their own, as a chat app marks its pinned chats, so a heading takes no room. They are left out of every other
  group, the ended one too: a pinned session that ended stays pinned, shown as ended.
- The rest are grouped and headed as they would be with none pinned: the colour, not a heading, tells the two apart.
- Search narrows the pinned ones as it does the rest.
- A pinned row says where it is as a row with no project heading does: its project's name beside the title.

## The rows

A row's actions (slid open on the web, slid or held on the phone) start with **Pin** or **Unpin**. What went wrong
is said as other row actions say it: an alert on the phone, the page's error on the web.

A row let go stays as it was unless moved past half its actions. With three actions that is further than it
was with two, so a row is opened or shut by a move past half its actions or past one, whichever is less
(`staysOpen` in `libs/client/src/sessions/rowSwipe.ts`, now told whether the row was open).

## Not in this

- Ordering the pinned ones by hand.
- Pinning conversations on the Mac (the Conversations page): they are not sessions until gone on with.
