# Starting a pane's new command when tmux gets no pty for it

2026-10-16. Read from source: tmux 3.6a and 3.7c `spawn.c` (`spawn_pane`), `window.c` (`window_pane_destroy`,
`window_pane_set_event`), `compat/fdforkpty.c`; tmux master `spawn.c`.

## What happens

Moving a session to another account, and going on after its Claude quit, end what the session's pane runs and start
Claude there again with `respawn-pane -k` (`apps/server/src/system/tmux.ts` `respawnPane`). On macOS that sometimes
fails with `fork failed: Device not configured`: tmux closes the pane's pty and at once asks for a new one, macOS hands
out the lowest free pty number, and the one just let go of can come back while its old device is still going away.
Twelve server test runs in CI failed this way between 2026-10-12 and 2026-10-15, all of them in `respawn-pane`, none
in `new-session`, which opens far more ptys but never right after letting one go.

When it fails, tmux has started nothing and leaves the pane empty: no process, and (until tmux 3.8) its input state
freed and not made again. tmux 3.6a and 3.7c free that state again on the next respawn of the pane without looking,
and the tmux server crashes, ending every session on it. So asking `respawn-pane` again is not a way out: on such a
tmux it turns one failed move into every session gone.

## Invariant

A pane tmux left empty is never respawned; its command starts in a new pane put in its place.

## What `respawnPane` does

1. Asks tmux whether the session's pane is dead (`#{pane_dead}`). With the managed `tmux.conf`, which keeps
   `remain-on-exit` off, only a respawn that failed leaves a pane dead.
2. A live pane is respawned, as before. A failure other than `fork failed` is passed on, as before.
3. A dead pane, or one that just failed with `fork failed`: the command starts in a new pane split from it
   (`split-window -t <pane>`, with the same folder, environment and command), and the empty one is killed
   (`kill-pane`), so the session keeps one window with one pane, running the command. A split that gets no pty
   either is removed by tmux on its own, safely, and is tried again a few times, waiting a little longer each time;
   after that the error is passed on and the pane stays empty, to be replaced the next time.

The session never leaves tmux on the way, so nothing reading the session list sees it end.

## Not in this

- What was on the empty pane's screen is not carried over: tmux already cleared it.
- tmux 3.8 checks before freeing; the new pane is used there too, as one way for every tmux.
