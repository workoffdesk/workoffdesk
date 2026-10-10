import type { Slow } from './api';

// Where a device tells the Mac of its slow requests, so the time a phone waits shows in the Mac's log.
export const SLOW_PATH = '/api/slow';
const BATCH_WAIT_MS = 3000;
const BATCH_MAX = 20;

// Slow tries gathered for a few seconds and told in one request; telling is never itself told.
export function createSlowReport(tell: (slow: Slow[]) => Promise<unknown>) {
  let batch: Slow[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (slow: Slow) => {
    if (slow.path === SLOW_PATH) return;
    if (batch.length < BATCH_MAX) batch.push(slow);
    timer ??= setTimeout(() => {
      timer = undefined;
      const told = batch;
      batch = [];
      tell(told).catch(() => {});
    }, BATCH_WAIT_MS);
  };
}
