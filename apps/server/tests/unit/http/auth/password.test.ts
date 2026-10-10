import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../../../src/http/auth/password.js';

describe('hashPassword and verifyPassword', () => {
  it('verifies the right password and rejects others', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('correct horse batterx', h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects a malformed stored hash instead of throwing', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});
