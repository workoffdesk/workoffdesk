import type { MacCheck } from './macPage';
import type { KeyValue } from '../base/platform';

export type SetupState = {
  checks: MacCheck[];
  user: string | null;
  origin: string | null;
  port: number;
  qr: string | null;
  remote: SetupRemote;
};
export type SetupStep = 'checks' | 'account' | 'address' | 'service' | 'phone';
export const SETUP_STEPS: readonly SetupStep[] = ['checks', 'account', 'address', 'service', 'phone'];
export type SetupRemote = {
  tailscale: { dnsName: string; running: boolean } | null;
  cloudflared: { tunnels: string[] } | null;
};
export type SetupAddress = { kind: 'tailscale' } | { kind: 'cloudflare'; tunnel: string; hostname: string } | { kind: 'other'; origin: string };

// What the service needs on the Mac; doctor's other checks are about what setup itself makes, or optional.
export const NEEDED_CHECKS: readonly string[] = ['macos', 'node', 'tmux', 'claude'];
export const missingChecks = (s: SetupState) => s.checks.filter((c) => NEEDED_CHECKS.includes(c.id) && !c.ok);

// The first step not done yet.
export function firstStep(s: SetupState): SetupStep {
  if (missingChecks(s).length) return 'checks';
  if (!s.user) return 'account';
  if (!s.origin) return 'address';
  return s.checks.some((c) => c.id === 'service' && c.ok) ? 'phone' : 'service';
}

const KEY = 'setup-token';

// The token comes in the address's fragment, which the browser sends to nobody; kept for the tab, so a
// reload after the fragment is gone still has it.
export function takeSetupToken(hash: string, storage: KeyValue): string | null {
  const given = hash.replace(/^#/, '');
  try {
    if (given) storage.setItem(KEY, given);
    return given || storage.getItem(KEY);
  } catch {
    return given || null;
  }
}
