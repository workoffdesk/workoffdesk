// What a device keeps of the Mac conversations it was shown: those shown in the last month, at most this many.
export const KEEP_MS = 30 * 24 * 3600_000;
export const KEEP_CHATS = 50;

export type Shown = { id: string; at: number };

// The copies to drop, of those kept and when each was last shown.
export function chatsToDrop(shown: Shown[], now: number): string[] {
  const lastFirst = [...shown].sort((a, b) => b.at - a.at);
  return lastFirst.filter((c, n) => n >= KEEP_CHATS || now - c.at > KEEP_MS).map((c) => c.id);
}
