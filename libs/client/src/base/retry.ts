// A read that failed on the way (the tunnel blinked, the Mac side is restarting) is tried again
// after these waits; anything the server actually answered is final.
export const RETRY_DELAYS = [300, 1000, 2000];

// A message is tried for longer: a restart of the Mac side, or a tunnel that blinks, lasts a few seconds.
export const SEND_RETRY_DELAYS = [300, 1000, 2000, 4000];

export const isTransient = (status: number | 'network') => status === 'network' || status === 502 || status === 503 || status === 504;

const statusOf = (e: unknown): number | 'network' | null => {
  if (e instanceof TypeError) return 'network';
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' || status === 'network' ? status : null;
};

export async function withRetry<T>(
  attempt: () => Promise<T>,
  o: { delays?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const delays = o.delays ?? RETRY_DELAYS;
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (e) {
      const status = statusOf(e);
      if (i >= delays.length || status === null || !isTransient(status)) throw e;
      await sleep(delays[i]);
    }
  }
}

// After a restart every phone comes back at once; spreading them over half a second keeps the
// server from taking them all in the same instant.
export function restartDelay(random = Math.random): number {
  return 250 + random() * 500;
}
