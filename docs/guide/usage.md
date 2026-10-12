# Usage

English · [简体中文](usage.zh-CN.md)

## The session list

After you sign in, the sessions running on the Mac are listed like a chat list: each row has the session's
name, when it last changed, and what Claude said last. Sessions are grouped by project: a git repository
with all its worktrees is one project, under its main folder's name, and a row in a worktree or a folder inside
it names that folder beside the session's name; a folder outside git is a project of its own. With one project
there is no heading. **Settings → Session list → Not grouped** lists them all in one, each row naming its
project; each phone or browser keeps its own choice. A badge says **Running** while Claude
works, **Needs you** when it waits for you, and **Unread** when it has said something you have not opened.
The search box at the foot filters by name or folder.

A session is named after its conversation: the title Claude Code or Codex gives it, which follows what the
conversation turns to, or the folder's name until there is one. Swipe a row left to **Rename** it, or tap the
title inside the session; Claude Code's own `/rename` names it too, and the later name wins. The name is kept
on the Mac, so every device sees it, and the conversation takes it in Claude Code's `/resume` list and in Codex
too.

A Claude or Codex session stays in the list after it ends, whether you ended it, its agent quit, or the Mac
restarted: it moves to the **Ended** group at the end of the list, its picture faded, and it opens to the conversation, kept on the Mac, with **Continue this
conversation** to go on with it in the same session. It is kept even after Claude Code deletes the conversation's
transcript (after 30 days, unless `cleanupPeriodDays` is set longer), though it can then only be read. Swipe a
row left (or hold it) for **End session** on a running one or **Delete** on an ended one; deleting
takes it off WorkOffDesk and leaves Claude's or Codex's own record as it is.

The clock button beside ⊕ opens **Conversations on the Mac**: every other Claude Code and Codex conversation the
Mac still has, however old, grouped by day, with a search box; tap one to read it and pick it up.

## Start or resume

The ⊕ button at the top offers:

- **New Claude in a project**: pick a folder (folders you list in `pinnedDirs` are always offered) and Claude
  starts there.
- **Resume a recent conversation**: the recent Claude and Codex conversations on the Mac, searchable, each
  with what you last asked in it; the Codex ones say **Codex**. Ones started by programs through the SDK are folded away under **Sessions of automated tasks**.
  A conversation opens to read first; **Continue on the phone** goes on with it here. One whose folder is no
  longer on the Mac, as when its worktree was removed, says so and cannot be gone on with.
- **New Codex in a project**, when [Codex](https://github.com/openai/codex) is installed on the Mac.

### Taking over from the Mac

A conversation still open in a terminal on the Mac is marked **Open on the Mac**, **Working on the Mac**,
**Asking you on the Mac** or **Commands left running on the Mac**. Taking it over quits Claude or Codex in that terminal and goes on in a session
here; the terminal is told how to attach to it. A Claude taken over keeps the terminal's environment; a Codex
runs its commands in the service's Codex app server instead.

- Open: **Take over to the phone**.
- Working: **Take over when this step is done**, or **Take over now (stops this step)**.
- Asking you: take over now; its question is dropped, so ask it to redo that step.
- Commands left running: Claude's turn is over and only commands it started go on. Take it over now; those
  commands stop with it. A take-over waiting for the step to be done goes ahead then too.

A Claude started with `workoffdesk claude`, or a Codex with `workoffdesk codex`, is a session already and
needs no taking over. A Codex conversation open in an editor or the Codex app cannot be taken over: close it
there first. When a session's
conversation is open in a terminal on the Mac as well, the session says so above the composer: quit Claude
there, or attach to the session instead.

### Codex sessions

A Codex session runs Codex's own terminal UI on the Mac, and the phone drives the same thread: the chat,
its permission requests as cards, Stop, the queue, pictures and notifications work as for Claude. Questions
Codex asks are answered with **Screen** or at the Mac. The `/` list, the model, permission and effort menus
and Rewind are Claude Code's, and are not offered.

## The chat

A Claude session is shown as its conversation, read from Claude Code's transcript: your messages, Claude's
replies rendered as Markdown, and tool calls folded (tap to see their output). Older turns load as you scroll
up. The phone keeps a copy of what it has read, so reopening a session is instant.

- While Claude works through a task list, a bar says how far along it is. **Stop** (in place of the send
  button while the composer is empty) interrupts it, like Esc.
- Commands running in the background are listed in a bar that opens `/tasks`.
- **Read aloud** under a reply reads it with the phone's voice.
- **Rewind** under your last message opens Claude Code's own list of points to go back to.
- When the chat cannot show what Claude is waiting on, **Screen** shows the Mac's screen as text.
- When Claude stops because its account hit a usage limit, the note says **Usage limit reached**. With another
  Claude account on the Mac that can be picked (see [This Mac](#this-mac)), **Go on with another account** lists
  them; picking one picks it on the Mac and moves this session to it, one taken over from a terminal too, then
  the other open sessions, as This Mac does; once this one runs there it is told "continue". A Claude in a
  terminal on the Mac holding the same conversation is quit first, unless it is at work there; when this session
  cannot move, the list says why. A message typed while stopped asks the same first, and goes once moved;
  closing the list puts it back in the box. With no other account,
  the note says how to sign in to one.

## Answering Claude

- **Questions and permission prompts** become a card of options. A permission is answered on a tap; a question's
  option is picked with a tap and sent with **Submit**, so a tap that missed is not an answer. Either way the Mac
  reads the screen again, and presses only if the options are still the same. **Write your own answer** moves to
  that option; you type the answer in the composer.
- **Questions with several answers** are ticked in the card and sent in one go.
- **Panels** opened by slash commands (`/usage`, `/config`, `/model`…) show as a card, with a bar above the
  composer while they are open. **Close (Esc)** closes them. While one is open, what you send stays in the
  composer, since it would go into the panel instead of to Claude.

## Sending

- Type in the composer. The key bar above it has Esc, Tab, a sticky Ctrl, the arrows, ^C, Paste and Enter.
- **Hold to talk**: the words show as you speak; let go to send, slide up to ✕ to cancel, or to **To text** to
  edit them first. It uses the browser's own speech recognition; no audio goes to the Mac.
- **Pictures, videos and files**: add them with the button beside the composer, up to 4 GB each. They are
  saved on the Mac and their paths go to Claude with your message. Uploads are deleted after 30 days.
- Typing `/` lists the slash commands Claude has in this session; `@` lists the files of its folder.
- The pill under the composer shows the context used, and switches the model, the permission mode and the
  effort.

## Queued messages

What you send while Claude is working goes straight into Claude's own queue, where it waits for Claude's next
step. While Claude is starting, asking you something, compacting its context, or has ended, messages wait on
the Mac instead, in order, and go in once it can take them. Both kinds are listed above the composer; the ones
waiting on the Mac can be edited, moved or dropped.

## Notifications

Add the site to the home screen, open it from there, and turn on **Push notifications** in Settings. You are
notified when Claude waits for you or finishes a turn. For the iPhone app, see [iPhone app](ios-app.md). In the
iPhone app, a tapped notification opens its session over the session list, wherever you were, so Back goes to the
list; already in that session, nothing moves.

## Devices and passwords

Settings lists **Logged-in devices**; **Revoke** signs one out at its next request. Passkeys are added and
removed on the same page. Forgot the password? Run `workoffdesk setup` again on the Mac: it sets a new one and
signs every device out.

## This Mac

Settings → **This Mac** shows what `doctor` checks on the Mac, each failure with the command that fixes it
(a tap copies it), the version and the releases kept, and the newest warnings and errors in the service's
log, each opening to its detail. **Restart** restarts the service without ending sessions; **Roll back**
goes back to the release before, after a second tap that names it. The page waits for the service to come
back and says how it went. Both need the service to run as installed, not as `workoffdesk serve`.

When the Mac is signed in to more than one Claude account (each in a config dir of its own, picked by
`CLAUDE_CONFIG_DIR`), the page lists them under **Claude account**, each with what its sessions last reported
of its 5-hour and 7-day limits. A tap on one makes it the account the sessions started from the phone or the
web run on, new ones and conversations gone on with alike; one taken over from a terminal keeps that
terminal's. Only an account that shares `~/.claude/projects` can be picked, so every conversation can go on
on it; one that does not, or is signed out, says why.

Sessions already open keep their account until you move them: when some run on another account, the page
says how many under the list, with **Move** to move them to the account checked. Each one moves between turns: one at its prompt at once, one
still working once its reply is done and what you sent it has gone in. Moving quits its Claude and starts it
again in the same window on the account picked, going on with the same conversation; a message sent
meanwhile waits and goes in after. Until they have moved the page says how many are moving and waits with them. Sessions
started from a terminal are not moved.

The same is at the Mac, in the menu bar app's **Claude Account** section and on the command line:

```bash
workoffdesk account                       # the accounts, the one in use checked, and the open sessions on another
workoffdesk account use <email|folder>    # pick one; add --move to move the open sessions too
workoffdesk account move                  # move the open sessions to the account in use
```

## At the Mac

```bash
workoffdesk attach        # pick a session
workoffdesk attach <id>   # join that one
workoffdesk claude        # start Claude in this folder as a session, and join it
workoffdesk claude --resume <id>   # the same, resuming that conversation
workoffdesk codex         # start Codex in this folder as a session, and join it
workoffdesk codex --resume <thread id>   # the same, going on with that thread
```

In a session, ⋯ → **Continue on the Mac** shows its `attach` command to copy. It is the same tmux session, so
the phone and the Mac can both be on it. `Ctrl-b d` detaches and leaves it
running. While no Mac terminal is attached, the phone sizes the window to 100×50 so dialogs fit; once one is,
the window follows that terminal.
