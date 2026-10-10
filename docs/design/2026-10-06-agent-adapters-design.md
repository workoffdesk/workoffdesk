# Agents behind one set of events: design

2026-10-06. What workoffdesk does, unchanged: you work in a Claude Code session at the Mac, leaves, and goes
on with the same session from the phone. What changes: how workoffdesk learns what the session needs and
answers it, so that it stops guessing from the screen where Claude Code says it itself, and so that a
second agent (Codex) can come in without a second set of guesses. Probes behind every claim here:
`2026-10-06-screen-to-structured-sources.md`.

## Decided

- **Claude sessions keep running in workoffdesk's tmux**, with the TUI, which the Mac attaches to. Headless
  `claude -p` and Claude Code's daemon cannot take over a session already open in a terminal (probed);
  Remote Control is tied to a claude.ai login.
- **What Claude Code reports, workoffdesk takes from it**: hooks, the transcript, the status line. The screen
  is read only for what nothing reports (dialogs of the TUI's own, the suggestion, the Screen view), and as the
  fallback when a hook is missed.
- **A Claude session open in another terminal** (another terminal app) is taken over only once it is idle and stopped:
  `claude --resume` on a session still running does not stop it; both go on writing one transcript and
  neither sees the other (probed). Taken over, it runs headless (step 4), so it needs no screen either.
- **Codex joins the session over its app-server**, which its own TUI also attaches to (`codex --remote`).

## Invariants

1. **One question, one card, one answer.** Whatever asks (a hook, the screen, Codex), the phone shows it
   once, and an answer reaches the question it was given for or nothing: never the next question in its
   place.
2. **The Mac never loses a question to the phone.** A question the phone holds is still on the Mac's
   screen and can be answered there; if workoffdesk goes away, the Mac's answer is all that is needed.
3. **The phone knows agents only through the events below.** Nothing in `apps/mobile` or `apps/web` names
   a Claude Code glyph, key or dialog; the adapter does.

## Events the phone knows

Kept as they are: the session (`TermSession`: status, usage, queue), the conversation (`ChatItem`), live
text. New, in `libs/client/src/api.ts`, on the session's screen answer (`OnScreen.asks`) and pushed on the
session's line like the rest of `OnScreen`:

```ts
// Something the agent waits on the person for.
type Ask = { id: string; kind: 'permission'; tool: string; title: string; detail: string;
             always: string[] };                     // the "don't ask again" offers, by the rule each adds

// What the phone says back, by POST /api/m/:machine/sessions/:id/asks/:askId; 409 when that ask is over.
type Answer = { allow: true; always?: number } | { allow: false };
```

Step 2 shipped these. Questions and plans (step 4) add their own kinds; the phone's "No" is the Mac's
No (the turn stops), so a reason to give Claude waits until there is a way to type one into the card.

`OnScreen.choices` and `OnScreen.panel` stay for what only the screen shows, and for apps that predate
`asks` (the iPhone app updates over the air, an old one may still run): the server keeps filling
`choices` for a question it also has as an ask until those apps are gone; a new app shows the ask and not the
screen's choice while it has one (invariant 1): the prompt a hook holds is the dialog on screen.

## Server shape

```
apps/server/src/agents/
  types.ts        Ask, Answer, and what an adapter gives the Machine
  claude/         today's claude/* (choices, panel, live, prompt, compacting, turn, chat …) moved here,
                  plus asks.ts: the asks the hooks hold
  codex/          app-server client (later)
```

`Machine` keeps what is the same for any agent: tmux sessions, the store, the outbox, listing. What a
session waits on comes from its adapter: `asks(id)`, `answer(id, askId, answer)`, and the screen reading
it already does. Shell sessions have no adapter.

## Claude: permission prompts by hook (first)

The hook command workoffdesk installs (`claude/hooks.ts`) posts to its own socket. For `PermissionRequest` it
waits for the reply instead: `curl --max-time 3600 … /permission`, its body printed as the hook's output;
the hook's timeout goes from 5 s to 3600 s. The server holds the request as an ask:

| What happens | Seen as | Then |
|---|---|---|
| Phone allows / denies | the answer | reply `{hookSpecificOutput:{hookEventName:'PermissionRequest', decision}}`: `{behavior:'allow', updatedPermissions?}`, "always" sending the offered `permission_suggestions` entry back as given (probed); `{behavior:'deny', message, interrupt:true}`, as the Mac's No |
| Mac answers Yes | `PostToolUse` or `PostToolUseFailure` with the same tool and input | reply nothing, drop the ask (the hook would otherwise wait for its timeout) |
| Mac answers No, Esc, Claude interrupted | Claude Code kills the hook: the request closes | drop the ask; the session is idle (no Stop comes) |
| Turn moves on, session ends | `UserPromptSubmit`, `Stop`, `StopFailure`, `SessionEnd`, or tmux has no session | reply nothing, drop |
| Nobody answers for an hour | the server's own timer, a little before the hook's | reply nothing: the dialog stays for the Mac |
| workoffdesk restarts | the hook's curl fails, `|| true`, no output | the TUI dialog stays (probed); after the restart the screen reading finds it as a choice, as today |
| Phone answers an ask already over | no such held request | 409; the phone says it was answered elsewhere |

`PermissionRequest` carries no tool_use_id (probed), so the Mac's Yes is known by the tool and input of
the call that then runs, compared with their keys in order. `AskUserQuestion` and `ExitPlanMode` are
answered with nothing at once and stay on the screen until step 4. A push goes out when the ask is made,
not on the `permission_prompt` notification six seconds later.

## Claude: later steps

2. **/model and /effort with an argument** from the app's own pickers (`/model opus`, `/effort high`), so no
   dialog opens; the current values from the status line. Probe first that 2.1.289 takes both without
   opening the dialog.
3. **Questions and plans from `PreToolUse`** (`AskUserQuestion`, `ExitPlanMode`): the exact questions,
   options and plan as asks. Answering stays keys on the TUI, mapped from the labels the phone sends to the
   options on screen, since no hook can answer them.
4. **Taking over a session open in another terminal** (another terminal app), as a baton: one process holds the
   session at a time. `claude agents --json` names every running Claude session on the Mac with its pid
   and busy/idle; the phone says "running in a terminal on the Mac" for it (today it can only guess from
   recent activity) and offers to take it over once it is idle. workoffdesk then stops that process and goes
   on with the session **headless** (`claude -p --resume <id>`, stream-json, as probed): the same
   session id and transcript, every prompt, question and plan as JSON, no screen at all. Back at the
   Mac, the phone hands it back: workoffdesk stops its process and the Mac resumes it (`claude --resume`).
   Taking over while it works would cut the turn short, so it waits for idle unless you say stop now.
   A headless session is a second kind of Claude session for the adapter, beside the tmux one; the
   events the phone gets are the same.

## Codex (after the Claude steps)

The adapter is a JSON-RPC client of the shared app-server daemon (`codex app-server daemon start`,
unix socket). A session is a thread: `thread/resume` (or `thread/start`), `turn/start` for a message,
`turn/steer` for one sent while it works, `turn/interrupt`. Asks come as server requests:
`item/commandExecution/requestApproval` and `item/fileChange/requestApproval` (permission: `accept`,
`acceptForSession`, `decline`), `item/tool/requestUserInput` (question); `serverRequest/resolved` ends one
answered elsewhere. The conversation from `item/started` / `item/completed`, live text from
`item/agentMessage/delta`, usage from `thread/tokenUsage/updated` and `account/rateLimits/updated`. On the
Mac, `codex --remote unix://…` shows the same thread. To probe before writing it: where the daemon's
socket is and whether two clients on one thread both get the approval request.

## Order, each its own release

1. Move `claude/*` under `agents/claude/` and give the Machine the adapter seam. No behaviour changes.
2. `Ask` / `Answer` in `libs/client`, the asks route, permission prompts by hook, the permission card in
   the iPhone app and the web app.
3. /model and /effort with an argument.
4. Questions and plans from PreToolUse.
5. Sessions open in another terminal: shown as such, taken over when idle.
6. Codex: probe, then the adapter.

## Not done, and why

- Headless `claude -p` for every Claude session: a session started in workoffdesk would have no TUI for the
  Mac to attach to while it runs. It is used for sessions taken over from another terminal (step 4).
- Claude Code's daemon sockets: undocumented; the pty one is the screen again, the other takes only text.
- Messages between sessions as the way in: they arrive as another session's, not yours, and answer no
  prompt. Possibly later, for a word to a session workoffdesk does not hold.
