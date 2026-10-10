// Where a session's agent is: what the session list and the chat show.
export type ClaudeStatus = 'starting' | 'working' | 'waiting' | 'idle' | 'ended' | 'compacting';

// Something an agent waits on the person for, as the phone is shown it.
// permission: the agent asks to use a tool. title is what it is used on (the command, the file); detail is
// the whole of it; always, what a "yes, and from now on" would also allow, when one is offered.
export type Ask = { id: string; kind: 'permission'; tool: string; title: string; detail: string; always: Always | null };
// rules: tool rules as Claude Code writes them (`Bash(touch:*)`); dirs: folders it may reach; mode: the
// permission mode it would switch to (`acceptEdits`).
export type Always = { rules: string[]; dirs: string[]; mode: string | null };

// What the person says back to an ask. always: allow from now on too, as the ask's `always` says.
export type Answer = { allow: true; always?: true } | { allow: false };
