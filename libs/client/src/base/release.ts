// The release of the server, as its answers name it (see api.ts). Code older than the server's can tell
// from it that there is newer code to load.
export function createReleaseWatch() {
  let last: string | null = null;
  const listeners = new Set<(version: string) => void>();
  return {
    saw(version: string) {
      if (version === last) return;
      const first = last === null;
      last = version;
      if (!first) for (const l of listeners) l(version);
    },
    subscribe(listener: (version: string) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type ReleaseWatch = ReturnType<typeof createReleaseWatch>;
