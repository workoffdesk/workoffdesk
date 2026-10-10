// How long a press on the empty bar lasts before it is talking rather than a tap to type.
export const HOLD_MS = 300;

export type Press = { held: () => boolean; end: () => 'tap' | 'held' };

// A finger down on the bar: held once it has stayed HOLD_MS, a tap if it comes up before.
export function startPress(onHeld: () => void): Press {
  let held = false;
  const timer = setTimeout(() => {
    held = true;
    onHeld();
  }, HOLD_MS);
  return {
    held: () => held,
    end: () => {
      clearTimeout(timer);
      return held ? 'held' : 'tap';
    },
  };
}
