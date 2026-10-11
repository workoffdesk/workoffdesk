// A picture in the viewer let go this far from where it was, or flicked, closes it, as in Photos.
export const SWIPE_CLOSE_OFFSET = 90;
export const SWIPE_CLOSE_VELOCITY = 1.4;

type Point = { x: number; y: number };

const unit = (p: Point): Point => {
  const d = Math.hypot(p.x, p.y);
  return { x: p.x / d, y: p.y / d };
};

// Which way a picture let go leaves the screen, or null when it stays. offset and velocity are its scroll
// view's, as iOS gives them: the opposite of the way the picture went.
export function swipeAway(offset: Point, velocity: Point): Point | null {
  const went = { x: -offset.x, y: -offset.y };
  const flung = { x: -velocity.x, y: -velocity.y };
  if (Math.hypot(went.x, went.y) > SWIPE_CLOSE_OFFSET) return unit(went);
  if (Math.hypot(flung.x, flung.y) <= SWIPE_CLOSE_VELOCITY) return null;
  return unit(Math.hypot(went.x, went.y) > 1 ? went : flung);
}
