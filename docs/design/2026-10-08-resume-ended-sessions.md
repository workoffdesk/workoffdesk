# Going on with a session whose agent quit

## What must hold

A session's conversation is not lost because its agent's process went away. A session says it has ended
exactly when its agent is no longer running, and from there one tap goes on with the same conversation, in
the same session: same id, same name, same journal, the messages still waiting.

## Who knows whether the agent runs

A Claude session's pane runs `<shell> -lc '<claude> …; exec <shell> -l'`. That wrapper waits for Claude and,
however Claude ends (`/exit`, a crash, SIGTERM, SIGKILL), replaces itself with a login shell. So the pane's own
process says it: while its command line is still `<shell> -lc …`, the agent runs; once it is `<shell> -l`, the
agent is gone. tmux names the pane's process (`#{pane_pid}`) in the listing the server already makes every
two seconds, and one `ps` reads the command lines.

Not used:

- The `SessionEnd` hook. Claude Code sends it on `/clear` too, while it goes on in the same process, and a
  killed Claude sends nothing. A session marked ended by `/clear` held every message sent to it from then on.
  The hook now only makes the server look at the process sooner.
- tmux's `#{pane_current_command}`. The wrapper runs Claude in its own process group, so the pane's foreground
  process is the shell while Claude runs too.
- `claude agents`, which lists running Claudes but leaves the ones WorkOffDesk started out of what the
  server asks of it.

## What reads it

- Each listing: a Claude session whose wrapper is gone is `ended`; one marked `ended` whose wrapper runs is
  read again from its screen, as after a restart. So a restart, a crash and a kill all end up `ended`, and a
  server started after them does not take a shell prompt for Claude idle at its prompt.
- Each delivery: a message is typed into the pane only after the process is looked at. A message sent to a
  session whose Claude was killed a moment ago waits, rather than being run by the shell left behind.
- A Codex session is not affected: its TUI may quit while the app server goes on with the thread.

## Going on in place

`POST /api/m/local/sessions/:id/continue` goes on with an ended Claude session's conversation in that session.

- The pane gets the same command a new session gets, through `tmux respawn-pane`, with `--resume <id>` when
  the conversation has a transcript and `--session-id <id>` when it has none (it ended before anything was
  said). Typing `claude --resume` into the shell left behind was not chosen: it would run through the
  person's shell setup and whatever was half typed at its prompt, and Claude would then be the shell's child,
  where the wrapper no longer tells whether it runs.
- The shell is left alone, and the request refused with `terminal-busy`, while something runs in it (someone
  at the Mac attached and started a program there).
- A conversation open in a terminal on the Mac is refused with `open-on-mac`, as resuming one is. The apps then
  open that conversation's take-over page; taking it over from there continues the ended session in place,
  since a resume of a conversation that an ended session here holds goes into that session.
- Asked twice at once (two taps, the phone and the web), the same start answers both, by conversation id, as
  for any resume. Asked of a session whose Claude runs, the session is answered as it is.
- The session is `starting` until Claude's `SessionStart` hook, so what waits goes once Claude is at its
  prompt. A Claude that quits at once ends the session again; the app says so and offers its screen.
- Nothing restarts on its own: a person who typed `/exit` meant it.

## In the apps

An ended session shows, where the box was, «Claude has quit», with **Continue this conversation** first and
**Start another** (a new conversation in the same folder) beside it, and what still waits to be sent. A
session gone from tmux (the Mac restarted, it was ended) offers the same first button, which resumes its
conversation in a new session.

## Not done

- A session gone from tmux is still dropped from the list; it is reached again only from the conversations on
  the Mac. Keeping it in the list, ended and ready to go on, changes what the store keeps, and is designed
  apart.
- A Codex app server that dies is not looked at here.
