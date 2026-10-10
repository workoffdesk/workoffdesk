import { useSyncExternalStore } from 'react';
import { release } from './api';

// An open page, and the home-screen app most of all, runs the build it loaded for as long as it stays
// open. It moves onto a newer one at the moments that interrupt nothing: coming back into view, and
// going to another page. Staying on one page, it offers the newer build once an answer from the server
// names a newer release.

const entry = (doc: Document) => doc.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src') ?? null;

const loaded = entry(document);
let checking = false;
let behind = false;
const listeners = new Set<() => void>();

async function liveEntry(): Promise<string | null> {
  const res = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) return null;
  return entry(new DOMParser().parseFromString(await res.text(), 'text/html'));
}

// now: move onto a newer build at once; otherwise only offer it.
async function check(now: boolean): Promise<void> {
  if (checking || !loaded) return;
  checking = true;
  try {
    const live = await liveEntry();
    if (!live || live === loaded) return;
    if (now) return location.reload();
    behind = true;
    for (const l of listeners) l();
  } catch {
    // Offline: the next look tries again.
  } finally {
    checking = false;
  }
}

export function keepFresh(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check(true);
  });
  window.addEventListener('popstate', () => void check(true));
  release.subscribe(() => void check(false));
}

// Whether a newer build than this page's is being served.
export const useBehind = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => behind,
  );
