import type { Api } from '../base/api';

// Where a message from another Claude on the Mac leads: the session here that goes on with that Claude's
// conversation, or the conversation's page for the Mac. The name it sent as is checked against its process.
export type SentFrom = { session: string } | { onMac: string };

export async function sentFrom(api: Api, pid: number, name: string): Promise<SentFrom> {
  const peer = await api<{ sid: string; openIn: string | null }>(`/api/claude/peers/${pid}?name=${encodeURIComponent(name)}`);
  return peer.openIn ? { session: peer.openIn } : { onMac: peer.sid };
}
