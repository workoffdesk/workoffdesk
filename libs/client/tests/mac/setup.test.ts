import { describe, expect, it } from 'vitest';
import { firstStep, takeSetupToken, type SetupState } from '../../src/mac/setup';
import { brokenStorage, memoryStorage } from '../helpers/fakes';

const state = (over: Partial<SetupState> = {}): SetupState => ({
  checks: [
    { id: 'macos', ok: true, detail: '' },
    { id: 'node', ok: true, detail: '' },
    { id: 'tmux', ok: true, detail: '' },
    { id: 'claude', ok: true, detail: '' },
    { id: 'setup', ok: false, detail: '' },
  ],
  user: null,
  origin: null,
  port: 7681,
  qr: null,
  remote: { tailscale: null, cloudflared: null },
  ...over,
});
const failing = (id: string) => state().checks.map((c) => (c.id === id ? { ...c, ok: false } : c));

describe('firstStep', () => {
  it.each(['macos', 'node', 'tmux', 'claude'])('starts at the checks while %s is missing', (id) => {
    expect(firstStep(state({ checks: failing(id), user: 'me', origin: 'https://a.example.com' }))).toBe('checks');
  });

  it('does not start at the checks for what setup itself makes or what is optional', () => {
    const checks = [...state().checks, { id: 'service', ok: false, detail: '' }, { id: 'apns', ok: false, detail: '' }];
    expect(firstStep(state({ checks }))).toBe('account');
  });

  it('starts at the address once there is an account, and at the service once there is an address', () => {
    expect(firstStep(state({ user: 'me' }))).toBe('address');
    expect(firstStep(state({ user: 'me', origin: 'https://a.example.com' }))).toBe('service');
    const stopped = [...state().checks, { id: 'service', ok: false, detail: '' }];
    expect(firstStep(state({ checks: stopped, user: 'me', origin: 'https://a.example.com' }))).toBe('service');
  });

  it('starts at the phone when the service already runs', () => {
    const checks = [...state().checks, { id: 'service', ok: true, detail: '' }];
    expect(firstStep(state({ checks, user: 'me', origin: 'https://a.example.com' }))).toBe('phone');
  });
});

describe('takeSetupToken', () => {
  it('takes the token from the fragment once and keeps it for the tab', () => {
    const storage = memoryStorage();
    expect(takeSetupToken('#abc_-1', storage)).toBe('abc_-1');
    expect(takeSetupToken('', storage)).toBe('abc_-1');
  });

  it('takes the newer one when the page opens from a new address', () => {
    const storage = memoryStorage({ 'setup-token': 'old' });
    expect(takeSetupToken('#new', storage)).toBe('new');
  });

  it('returns none without a fragment or a kept one', () => {
    expect(takeSetupToken('', memoryStorage())).toBeNull();
    expect(takeSetupToken('#', memoryStorage())).toBeNull();
  });

  it('still works for the page it came with when storage is blocked', () => {
    expect(takeSetupToken('#abc', brokenStorage)).toBe('abc');
  });
});
