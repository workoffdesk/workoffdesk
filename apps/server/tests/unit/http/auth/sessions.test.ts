import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LoginSessions } from '../../../../src/http/auth/sessions.js';
import { Store } from '../../../../src/system/store.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

describe('LoginSessions', () => {
  const setup = () => {
    let t = 1_000_000;
    const store = new Store(join(mkdtempSync(join(tmpdir(), 'ts-auth-')), 'state.json'));
    const ls = new LoginSessions(store, () => t);
    return { store, ls, advance: (ms: number) => (t += ms) };
  };

  it('creates a 256-bit id that validates', () => {
    const { ls } = setup();
    const id = ls.create('UA', 'password');
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ls.validate(id)?.ua).toBe('UA');
    expect(ls.validate('nope')).toBeNull();
  });

  it('slides the 30-day expiry on use', () => {
    const { ls, advance } = setup();
    const id = ls.create('UA', 'password');
    advance(29 * DAY);
    expect(ls.validate(id)).not.toBeNull();
    advance(29 * DAY);
    expect(ls.validate(id)).not.toBeNull();
  });

  it('expires after 30 days without use and removes the row', () => {
    const { ls, store, advance } = setup();
    const id = ls.create('UA', 'password');
    advance(30 * DAY + 1);
    expect(ls.validate(id)).toBeNull();
    expect(store.get().logins).toHaveLength(0);
  });

  it('revokes immediately', () => {
    const { ls } = setup();
    const id = ls.create('UA', 'passkey');
    ls.revoke(id);
    expect(ls.validate(id)).toBeNull();
    expect(ls.list()).toHaveLength(0);
  });

  it('writes lastSeen to disk at most once a minute', () => {
    const { ls, store, advance } = setup();
    const id = ls.create('UA', 'password');
    const first = store.get().logins[0].lastSeen;
    advance(30_000);
    ls.validate(id);
    expect(store.get().logins[0].lastSeen).toBe(first);
    advance(31_000);
    ls.validate(id);
    expect(store.get().logins[0].lastSeen).toBe(first + 61_000);
  });
});
