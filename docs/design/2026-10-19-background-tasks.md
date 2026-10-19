# Claude's background tasks, managed from the phone

The bar over the composer names what Claude runs in the background and has Manage, which opens Claude
Code's own `/tasks` dialog. Two things went wrong with it.

## The dialog read as a question

`/tasks` draws its rows the way a question draws its options (`❯ ⏺ sleep 901   running`), so the chat took
it for one: a card of options with Submit, and nothing to say how to leave. Submit pressed Enter, which opens
a row's details; Esc there closes the whole dialog (`Shell details dismissed`), so each try ended where it
began.

What the dialog is, as Claude Code 2.1.303 draws it (`apps/server/tests/fixtures/screens/tasks-*.txt`):

| Screen | Heading | Key hint |
| --- | --- | --- |
| the list | `Background`, then `2 active shells` or `No tasks currently running` | `↑/↓ to select · Enter to view · x to stop · Esc to close` |
| one row | `Shell details`, then `Status:`, `Runtime:`, `Command:`, `Output:` | `← to go back · Esc/Enter/Space to close · x to stop` |

`x` stops the selected row at once, with no question, and the list stays open with one row fewer.

The dialog is now a panel of its own kind, known by its key hint, never a question:

- The list: a row for each task, its words and its status, each with View (arrows to it, then Enter) and Stop
  (arrows to it, then `x`). An empty list says so. Close sends Esc.
- One row: what it ran, its status and how long, and its output. Back to the list sends `←`, Stop sends `x`,
  Close sends Esc.
- What is shown is always what the screen shows next: a key Claude Code did not take leaves the row there.

## The bar counted tasks that had ended

The bar's list is every background task the transcript started and has not seen end. Two ends were missed:

- A notification that ends several at once (Claude Code sends one for the shells a restart stopped) names
  each in its own `<task-id>`; only the first was read.
- A notification Claude took while it worked can be written only into its queue (`queue-operation`
  `enqueue`), never as a prompt of its own; those were not read.

Both are now read, so the bar names what the dialog lists.
