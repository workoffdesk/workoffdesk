import { randomBytes } from 'node:crypto';
import type { Login, Store } from '../../system/store.js';

const TTL = 30 * 24 * 60 * 60_000;
const TOUCH_INTERVAL = 60_000;

export class LoginSessions {
  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {}

  create(ua: string, method: Login['method']): string {
    const id = randomBytes(32).toString('base64url');
    const t = this.now();
    this.store.update((s) => {
      s.logins.push({ id, createdAt: t, lastSeen: t, ua, method });
    });
    return id;
  }

  validate(id: string): Login | null {
    const t = this.now();
    const login = this.store.get().logins.find((l) => l.id === id);
    if (!login) return null;
    if (t - login.lastSeen > TTL) {
      this.revoke(id);
      return null;
    }
    if (t - login.lastSeen >= TOUCH_INTERVAL) {
      this.store.update((s) => {
        const l = s.logins.find((x) => x.id === id);
        if (l) l.lastSeen = t;
      });
    }
    return this.store.get().logins.find((l) => l.id === id) ?? null;
  }

  revoke(id: string): void {
    this.store.update((s) => {
      s.logins = s.logins.filter((l) => l.id !== id);
    });
  }

  list(): Login[] {
    const t = this.now();
    return this.store.get().logins.filter((l) => t - l.lastSeen <= TTL);
  }
}
