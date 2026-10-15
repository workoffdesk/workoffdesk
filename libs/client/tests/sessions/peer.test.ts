import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../../src/base/api';
import { sentFrom } from '../../src/sessions/peer';

describe('sentFrom', () => {
  it('asks the Mac for the Claude of that process, under the name it sent as', async () => {
    const api = vi.fn(async () => ({ sid: 'conv-1', openIn: null })) as unknown as Api;
    await sentFrom(api, 73750, 'Docs & notes');
    expect(api).toHaveBeenCalledWith('/api/claude/peers/73750?name=Docs%20%26%20notes');
  });

  it('leads to the session here that goes on with its conversation', async () => {
    const api = vi.fn(async () => ({ sid: 'conv-1', openIn: 'abc123' })) as unknown as Api;
    await expect(sentFrom(api, 1, 'Docs')).resolves.toEqual({ session: 'abc123' });
  });

  it("leads to its conversation's page for the Mac when no session here has it", async () => {
    const api = vi.fn(async () => ({ sid: 'conv-1', openIn: null })) as unknown as Api;
    await expect(sentFrom(api, 1, 'Docs')).resolves.toEqual({ onMac: 'conv-1' });
  });
});
