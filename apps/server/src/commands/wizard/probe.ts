// What the wizard reads of `tailscale status --json` and `cloudflared tunnel list --output json`; out is the
// command's stdout, null when it failed to run.

const parse = (out: string | null): unknown => {
  try {
    return out === null ? null : JSON.parse(out);
  } catch {
    return null;
  }
};

export function tailscaleOf(out: string | null): { dnsName: string; running: boolean } {
  const s = parse(out) as { BackendState?: unknown; Self?: { DNSName?: unknown } } | null;
  const dnsName = typeof s?.Self?.DNSName === 'string' ? s.Self.DNSName.replace(/\.$/, '') : '';
  return { dnsName, running: s?.BackendState === 'Running' && dnsName !== '' };
}

export function tunnelsOf(out: string | null): string[] {
  const list = parse(out);
  return Array.isArray(list) ? list.map((t: { name?: unknown }) => t?.name).filter((n): n is string => typeof n === 'string') : [];
}
