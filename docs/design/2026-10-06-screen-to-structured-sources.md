# What workoffdesk reads off the screen, and what could tell it instead

2026-10-06. Everything the server learns by parsing tmux captures today, and for each, a source inside
Claude Code that says the same thing as data. Claude Code 2.1.289, tmux 3.6a. Facts about Claude Code are
from code.claude.com/docs (hooks, statusline, remote-control) as of today; every row marked **probe** is
what the docs say and has not been seen to hold on this machine yet.

Why: every wrong or missed dialog so far (#36, #41, #45: /effort not recognised while Claude worked) came
from a regex reading the screen. The official Remote Control does not read a screen at all: Claude Code
sends the conversation, permission prompts and questions as data, and takes the model and effort as
settings, not as keys in a dialog.

## Today

All screen reading goes through `Machine.onScreen` (`apps/server/src/machine.ts:305`): four
`tmux capture-pane` runs per look, every 250 ms per watched session (`session-ws.ts` `SCREEN_MS`), and
more around a command or key press. What it feeds:

| # | What | Parser | Used for |
|---|---|---|---|
| 1 | Permission prompt (run this command? edit this file?) | `parseChoices` (`claude/choices.ts`) | Choice card, waiting status, answer by keys (`keysToChoose`) |
| 2 | Claude's question (AskUserQuestion), one or several answers | `parseChoices` | Question card, ticks, answer by keys |
| 3 | Plan approval (ExitPlanMode) | `parseChoices` + `withPlan` | Plan card |
| 4 | MCP server asking for input | `parseChoices` | Choice card |
| 5 | Dialogs before the prompt (trust this folder?) | `parseChoices` | Choice card, waiting status |
| 6 | Slash-command dialogs: /model, /effort, /config, /usage, /btw | `parsePanel`, opened pickers in `parseChoices` | Popup in the app, keys by `/keys`, `/close` |
| 7 | Text Claude is writing, before the transcript has it | `liveText` (`claude/live.ts`) | Live reply bubble |
| 8 | Suggested next prompt (dimmed) | `suggestionOn` (`claude/prompt.ts`) | Suggestion chip |
| 9 | Permission mode (footer) | `modeOn` | Mode in the pill |
| 10 | Compacting | `isCompacting` | Backup to the PreCompact/PostCompact hooks, which workoffdesk already takes |
| 11 | "A dialog has the keyboard" before pasting or typing a command | `dialogOpen` = any of 1–6 | Outbox holds messages; commands refused |
| 12 | Status of a session the server did not see start | `readStatus` = 1–6 + transcript | Waiting / working / idle after a restart |
| 13 | The screen itself | `screenText` | the Screen view |

Already structured, not from the screen: the conversation (transcript jsonl), status transitions (hooks),
context / limits / cost / model / effort (status line, `claude/usage.ts`).

## Where each could come from

| # | Structured source | What it gives | Can it answer? | Confidence |
|---|---|---|---|---|
| 1 | `PermissionRequest` hook | `tool_name`, `tool_input`, `permission_suggestions` (no `tool_use_id`) | Yes: `allow` / `deny` with `message`, `updatedPermissions` for "always allow" | **Probed**, see below. Default command-hook timeout 600 s; workoffdesk sets 5 s today |
| 2 | `PreToolUse` hook, matcher `AskUserQuestion` (PermissionRequest does not fire for it) | The questions, options, multi-select, exactly as Claude wrote them | Not known: no documented way to hand back answers. Answer stays keys on the TUI | **probe**: whether `updatedInput` or another field can carry answers |
| 3 | `PreToolUse` hook, matcher `ExitPlanMode` | The plan text | No documented way; keys | **probe** |
| 4 | `Elicitation` hook | Server name, form fields | Yes: `accept` / `decline` / `cancel` with `content` | **probe** |
| 5 | None | — | — | Stays on screen |
| 6a | /model, /effort: type the command **with an argument** (`/model opus`, `/effort high`), from the app's own picker; current values from the status line, model changes also from `PostModelSwitch` | No dialog opens, so nothing to parse or close | — | **probe**: that both take an argument on 2.1.289 without opening the dialog |
| 6b | /usage | Status line `rate_limits` already gives the two figures the popup shows | — | Known; the popup could be dropped for the pill's usage menu |
| 6c | /config, /btw, others | None | — | Stay on screen |
| 7 | `MessageDisplay` hook ("while assistant message text is displayed", 10 s default timeout) | Text as it is shown | — | **probe**: payload shape, how often it fires, cost of one process per firing |
| 8 | None documented | — | — | Stays on screen |
| 9 | `permission_mode` in every hook's input; status line re-runs when the mode changes | Mode, but only when something fires | — | **probe**: whether the status line payload carries the mode (not in the documented fields) |
| 10 | `PreCompact` / `PostCompact` | Already used | — | Screen stays only as the backup it is |
| 11 | Derived: a held PermissionRequest / Elicitation is known without looking; 2, 3, 5, 6c still need the screen | — | — | Follows 1–6 |
| 12 | Transcript + held hooks; screen for the rest | — | — | Follows 1–6 |
| 13 | Screen by definition | — | — | Stays; colours later from a terminal emulator (below) |

## Probe: PermissionRequest (row 1), 2026-10-06 04:32–04:36

Real Claude Code 2.1.289 on its own tmux socket, `--permission-mode default` (a user's settings that start in
auto mode, where nothing asks, were not used), `--settings` with a PermissionRequest command hook that held until an
answer file appeared, and a logger on the other events. What held:

1. **The hook and the TUI dialog are up at the same time.** Holding the hook does not hide or delay the
   dialog: the phone and the Mac race, and whichever answers first wins.
2. **Hook says `allow`:** the dialog closes, the tool runs, the TUI shows "Allowed by PermissionRequest hook".
3. **Hook says `deny` with a `message`:** the tool does not run, Claude is told the message ("Error:
   Declined from the phone") and carries on from there; the turn is not interrupted.
4. **Hook says `allow` with `updatedPermissions`** `[{type:'addRules', rules:[{toolName:'Bash',
   ruleContent:'touch:*'}], behavior:'allow', destination:'session'}]`: the next `touch` ran without
   asking and without the hook. The input's `permission_suggestions` are in this same shape
   (`addDirectories`, `setMode` seen), so "always allow" can hand one back as given.
5. **Hook exits with no output:** the dialog stays and the Mac answers as before. Nothing is lost when the
   server is down or gives up.
6. **Mac answers Yes in the TUI while the hook is held:** the tool runs, then PostToolUse and Stop; the
   hook process is **not** stopped and keeps waiting. A late answer from it is ignored.
7. **Mac answers No:** the hook is killed (SIGTERM), the turn ends as "Interrupted · What should Claude do
   instead?", and **no** Stop hook comes.
8. The input has no `tool_use_id`, despite the docs; the PreToolUse just before it does
   (`toolu_…`), and so does the PostToolUse after. The input carries `permission_mode` and
   `effort.level`.
9. The Notification `permission_prompt` came ~6 s after the dialog opened: the hook is the first word,
   not the notification.

So for workoffdesk: the hook command connects to the server and waits; the phone's answer goes back through
it. A question the phone holds is over when the hook's connection closes (case 7), the PostToolUse with
the PreToolUse's `tool_use_id` arrives (case 6), or the hook's own answer is given; the server must end a
case-6 hook itself (answer nothing) so it does not linger until its timeout. The hook's timeout must be
long (the default 600 s, not workoffdesk's 5 s), and the server must answer nothing rather than fail when it
cannot reach the phone.

## What stays on the screen afterwards

Questions and plan approval (answering, if not reading), dialogs before the prompt, /config, /btw, the
suggestion, and the Screen view. For those, reading the screen better rather than not at all: `tmux pipe-pane`
copies the pane's output to a process that keeps it in a headless terminal emulator (`@xterm/headless`),
so the screen is pushed on change instead of polled, and parsers can see which line is reversed (selected)
or dimmed instead of guessing from glyphs. `pipe-pane` is not a client, so it takes no part in sizing the
window; `tmux -C` would, and needs checking for that.

Not chosen: `claude -p --input-format stream-json --output-format stream-json` (no TUI, so no dialogs to
read, but no /model, /effort, /config either and nothing to watch on the Mac); Remote Control (tied to a
claude.ai subscription login and Anthropic's relay; workoffdesk cannot join its protocol).

## Order

Each step is a probe first, on its own tmux socket and home, with real Claude, never `~/.workoffdesk`:

1. **Permission prompts by hook (row 1).** Biggest share of what the phone answers, and the hook can both
   say and answer. The hook command must hold until the phone answers or the Mac does, then give way to
   the TUI dialog.
2. **/model and /effort with an argument (6a).** Removes the two dialogs that went wrong most, with no
   new machinery.
3. **Questions and plans read from PreToolUse (2, 3).** Exact text and options instead of parsed lines;
   answering stays keys unless the probe finds otherwise.
4. **Live text from MessageDisplay (7)**, if the probe shows it is cheap enough.
5. **pipe-pane + headless emulator** for what stays on the screen, and colours in the Screen view.

## Probe: headless `claude -p` and Claude Code's own daemon, 2026-10-06 04:45–05:05

**Headless works for a session workoffdesk starts.** `claude -p --input-format stream-json --output-format
stream-json --verbose --include-partial-messages --permission-prompt-tool stdio`, then an `initialize`
control request as the Agent SDK sends (without it, prompts are denied outright and AskUserQuestion is
not among the tools). Seen on 2.1.289:

- Permission prompts come as `control_request` `can_use_tool` (tool, input, `permission_suggestions`,
  `tool_use_id`); `{behavior:'allow', updatedInput}` runs the tool.
- AskUserQuestion comes the same way with the questions; `allow` with `updatedInput.answers`
  (`{question text: label}`) answers it. ExitPlanMode comes with the plan text; `allow` approves.
- `set_model` switches the model; `apply_flag_settings {effortLevel}` switches the effort, and
  `get_settings` reports `applied: {model, effort}`. `set_permission_mode` switches the mode.
- `/compact` works as a user message, with `status: compacting` and `compact_boundary`.
- Partial messages stream; `rate_limit_event` carries the 5-hour and 7-day figures each turn.
- No `prompt_suggestion` came in three turns, with the flag, the initialize field and
  `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=true`. Not found why.

**But it cannot take over a session already running in a terminal**, which is what workoffdesk is for:
You start work at the Mac, leave, and go on from the phone. A headless process is one workoffdesk
starts; the terminal's Claude would have to stop and be resumed.

**Claude Code's daemon (`claude --bg`, `claude attach`, `claude agents`) is no way in either.** Each
background session is the TUI in a pty the daemon holds (`ptySock` in `~/.claude/daemon/roster.json`);
`claude attach` shows that pty. Its other socket (`rendezvousSock`) takes only an auth token, `reply`
(text typed in as a message), `repaint`, `attacher-caps` and `shutdown`: no events, no permission
prompts. Undocumented, read from the 2.1.289 bundle; not something to build on. `claude agents --json`
does list every interactive and background session on the Mac with its status (busy/idle).

The SDK's "reattach to a daemon" and `@anthropic-ai/claude-agent-sdk/bridge` are Remote Control's
cloud relay (`/v1/code/sessions/{id}/bridge`), tied to a claude.ai login.

So for a session that must stay usable in a terminal on the Mac, the TUI stays, workoffdesk keeps owning
where it runs (tmux, which the Mac attaches to), and the structured sources are the hooks (above),
the transcript and the status line. Codex differs: its TUI attaches to the shared app-server daemon
(`codex --remote`), so workoffdesk can join the same session over JSON-RPC with no screen at all.
