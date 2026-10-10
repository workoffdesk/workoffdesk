import { describe, expect, it } from 'vitest';
import { Lockout } from '../../../../src/http/auth/lockout.js';

const MIN = 60_000;

describe('Lockout', () => {
  const clock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it('locks an IP on its 5th failure within 15 minutes and unlocks after 15 more', () => {
    const c = clock();
    const l = new Lockout(c.now);
    for (let i = 0; i < 4; i++) l.fail('1.1.1.1');
    expect(l.check('1.1.1.1').ok).toBe(true);
    l.fail('1.1.1.1');
    const r = l.check('1.1.1.1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterSec).toBeGreaterThan(14 * 60);
    expect(l.check('2.2.2.2').ok).toBe(true);
    c.advance(15 * MIN + 1);
    expect(l.check('1.1.1.1').ok).toBe(true);
  });

  it('forgets failures older than the 15-minute window', () => {
    const c = clock();
    const l = new Lockout(c.now);
    for (let i = 0; i < 4; i++) l.fail('1.1.1.1');
    c.advance(16 * MIN);
    l.fail('1.1.1.1');
    expect(l.check('1.1.1.1').ok).toBe(true);
  });

  it('locks password login globally after 20 failures in an hour from any IPs', () => {
    const c = clock();
    const l = new Lockout(c.now);
    for (let i = 0; i < 19; i++) l.fail(`10.0.0.${i}`);
    expect(l.check('9.9.9.9').ok).toBe(true);
    l.fail('10.0.1.1');
    expect(l.check('9.9.9.9').ok).toBe(false);
    c.advance(60 * MIN + 1);
    expect(l.check('9.9.9.9').ok).toBe(true);
  });

  it('clears an IP counter on success', () => {
    const l = new Lockout();
    for (let i = 0; i < 4; i++) l.fail('1.1.1.1');
    l.succeed('1.1.1.1');
    l.fail('1.1.1.1');
    expect(l.check('1.1.1.1').ok).toBe(true);
  });
});
