import { describe, expect, it } from 'vitest';
import { tailscaleOf, tunnelsOf } from '../../../../src/commands/wizard/probe.js';

describe('tailscaleOf', () => {
  it("takes the Mac's tailnet name without its last dot, and whether Tailscale is up", () => {
    const out = JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'mac.tail1234.ts.net.' } });
    expect(tailscaleOf(out)).toEqual({ dnsName: 'mac.tail1234.ts.net', running: true });
  });

  it.each([
    ['stopped', JSON.stringify({ BackendState: 'Stopped', Self: { DNSName: '' } })],
    ['signed out', JSON.stringify({ BackendState: 'NeedsLogin' })],
    ['running with no name (MagicDNS off)', JSON.stringify({ BackendState: 'Running', Self: { DNSName: '' } })],
    ['not answering', null],
    ['answering something else', 'failed to connect to local tailscaled'],
  ])('counts Tailscale as not up when it is %s', (_, out) => {
    expect(tailscaleOf(out).running).toBe(false);
  });
});

describe('tunnelsOf', () => {
  it("takes the tunnels' names", () => {
    expect(tunnelsOf(JSON.stringify([{ id: '1', name: 'home' }, { id: '2', name: 'work' }]))).toEqual(['home', 'work']);
  });

  it.each([
    ['none (cloudflared prints null)', 'null'],
    ['not signed in', null],
    ['not JSON', 'You need to login'],
  ])('finds no tunnels when there are %s', (_, out) => {
    expect(tunnelsOf(out)).toEqual([]);
  });
});
