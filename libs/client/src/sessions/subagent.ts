import type { Api } from '../base/api';

// A sub-agent a Claude conversation started (the Agent tool, Task in older Claude Code), found under that
// conversation by the id of the call that started it.
export const startsSubagent = (name: string) => name === 'Agent' || name === 'Task';

const under = (sid: string, tool: string) => `${sid}/agents/${encodeURIComponent(tool)}`;
export const subagentPage = (sid: string, tool: string) => `/claude/${under(sid, tool)}`;
export const subagentChatUrl = (sid: string, tool: string) => `/api/claude/sessions/${under(sid, tool)}/chat`;
export const subagentOf = (api: Api, sid: string, tool: string) =>
  api<{ description: string }>(`/api/claude/sessions/${under(sid, tool)}`);
