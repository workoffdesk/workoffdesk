const MIN = 60_000;
const IP_WINDOW = 15 * MIN;
const IP_MAX_FAILURES = 5;
const IP_LOCK = 15 * MIN;
const GLOBAL_WINDOW = 60 * MIN;
const GLOBAL_MAX_FAILURES = 20;
const GLOBAL_LOCK = 60 * MIN;

export type LockCheck = { ok: true } | { ok: false; retryAfterSec: number };

export class Lockout {
  private failures = new Map<string, number[]>();
  private lockedUntil = new Map<string, number>();
  private globalFailures: number[] = [];
  private globalLockedUntil = 0;

  constructor(private readonly now: () => number = Date.now) {}

  check(ip: string): LockCheck {
    const t = this.now();
    const until = Math.max(this.lockedUntil.get(ip) ?? 0, this.globalLockedUntil);
    return until > t ? { ok: false, retryAfterSec: Math.ceil((until - t) / 1000) } : { ok: true };
  }

  fail(ip: string): void {
    const t = this.now();
    const recent = (this.failures.get(ip) ?? []).filter((x) => t - x < IP_WINDOW);
    recent.push(t);
    this.failures.set(ip, recent);
    if (recent.length >= IP_MAX_FAILURES) {
      this.lockedUntil.set(ip, t + IP_LOCK);
      this.failures.delete(ip);
    }
    this.globalFailures = this.globalFailures.filter((x) => t - x < GLOBAL_WINDOW);
    this.globalFailures.push(t);
    if (this.globalFailures.length >= GLOBAL_MAX_FAILURES) {
      this.globalLockedUntil = t + GLOBAL_LOCK;
      this.globalFailures = [];
    }
  }

  succeed(ip: string): void {
    this.failures.delete(ip);
  }
}
