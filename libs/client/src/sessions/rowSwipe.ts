// A session's row slides left under the finger to show its actions, in both apps.

// How wide each action is, and how far a finger moves before it is a swipe or a scroll, not a tap.
export const ACTION_PX = 88;
export const SWIPE_PX = 10;

// What a finger that moved this far from where it went down is doing: neither yet, sliding the row, or scrolling
// the list, which up and down is.
export function gestureOf(mx: number, my: number): 'swipe' | 'scroll' | null {
  if (Math.abs(mx) < SWIPE_PX && Math.abs(my) < SWIPE_PX) return null;
  return Math.abs(mx) > Math.abs(my) ? 'swipe' : 'scroll';
}

// Where the row is under the finger, from where it was: never right of shut, nor left of its actions.
export const rowShift = (open: boolean, width: number, mx: number) => Math.min(0, Math.max(-width, (open ? -width : 0) + mx));

// Whether a row let go there stays open, from open or shut: as it was unless moved past half its actions, or past
// one when it has more than two.
export function staysOpen(open: boolean, shift: number, width: number): boolean {
  const far = Math.min(width / 2, ACTION_PX);
  return open ? shift - -width < far : shift < -far;
}
