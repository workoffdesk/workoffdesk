// Asks the app to start its JS again, and says so once if it did not: refused (with why), or still running after
// waitMs, whatever reload answered. Started again, this JS is gone and nothing is said.
export function watchReload(reload: () => Promise<unknown>, waitMs: number, onStuck: (why: string | null) => void): void {
  let said = false;
  const say = (why: string | null) => {
    if (said) return;
    said = true;
    clearTimeout(timer);
    onStuck(why);
  };
  const timer = setTimeout(() => say(null), waitMs);
  reload().catch((e: unknown) => say(e instanceof Error ? e.message : String(e)));
}
