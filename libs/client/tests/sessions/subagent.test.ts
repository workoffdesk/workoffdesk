import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../../src/base/api';
import { startsSubagent, subagentChatUrl, subagentOf, subagentPage } from '../../src/sessions/subagent';

describe('a sub-agent a Claude conversation started', () => {
  it.each(['Agent', 'Task'])('is started by a %s call', (name) => {
    expect(startsSubagent(name)).toBe(true);
  });

  it.each(['Bash', 'Read', 'agent', 'TaskCreate'])('is not started by a %s call', (name) => {
    expect(startsSubagent(name)).toBe(false);
  });

  it('is found under its conversation by the id of the call that started it', () => {
    expect(subagentPage('conv-1', 'toolu_01B')).toBe('/claude/conv-1/agents/toolu_01B');
    expect(subagentChatUrl('conv-1', 'toolu_01B')).toBe('/api/claude/sessions/conv-1/agents/toolu_01B/chat');
  });

  it('keeps an id with characters a path gives meaning to inside its own segment', () => {
    expect(subagentPage('conv-1', 'a/../b?c')).toBe('/claude/conv-1/agents/a%2F..%2Fb%3Fc');
    expect(subagentChatUrl('conv-1', 'a/../b?c')).toBe('/api/claude/sessions/conv-1/agents/a%2F..%2Fb%3Fc/chat');
  });

  it('says what it was started to do', async () => {
    const api = vi.fn(async () => ({ description: 'Saturday run' })) as unknown as Api;
    await expect(subagentOf(api, 'conv-1', 'toolu_01B')).resolves.toEqual({ description: 'Saturday run' });
    expect(api).toHaveBeenCalledWith('/api/claude/sessions/conv-1/agents/toolu_01B');
  });
});
