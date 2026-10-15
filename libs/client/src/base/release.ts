// The release of the server, as its answers name it (see api.ts). Code older than the server's can tell
// from it that there is newer code to load; code newer than the server's, that the server is too old for it.

// The oldest server release this client works against. An App Store app runs one JS against every Mac's
// server, so when the client starts to need something a release before did not have, this moves to the
// release that has it (the package's version, which the server names).
export const MIN_SERVER = '1.0.2';

const RELEASE = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/;

// A release that cannot be read says nothing: a server always names one, and a proxy or the demo may not.
export function serverTooOld(server: string, min: string = MIN_SERVER): boolean {
  const s = RELEASE.exec(server);
  const m = RELEASE.exec(min);
  if (!s || !m) return false;
  for (let i = 1; i <= 3; i++) {
    const d = Number(s[i]) - Number(m[i]);
    if (d) return d < 0;
  }
  // A pre-release comes before the release of the same number.
  return !!s[4] && !m[4];
}

export function createReleaseWatch() {
  let last: string | null = null;
  const movedOn = new Set<(version: string) => void>();
  const followers = new Set<() => void>();
  return {
    saw(version: string) {
      if (version === last) return;
      const first = last === null;
      last = version;
      for (const f of followers) f();
      if (!first) for (const l of movedOn) l(version);
    },
    // Told when the release moves on, not when it is first seen.
    subscribe(listener: (version: string) => void) {
      movedOn.add(listener);
      return () => void movedOn.delete(listener);
    },
    current: () => last,
    // Another server is talked to now: its release is not known yet.
    forget() {
      if (last === null) return;
      last = null;
      for (const f of followers) f();
    },
    // Told whenever the release now changes, the first one seen too.
    follow(listener: () => void) {
      followers.add(listener);
      return () => void followers.delete(listener);
    },
  };
}

export type ReleaseWatch = ReturnType<typeof createReleaseWatch>;
