// Where the open page is across the window: all of it, or what the session list beside it leaves.
export type PageFrame = { x: number; width: number };

// The left edge, from a view at fromX on the window, and the width of what lies over the page from side to side.
export function acrossPage(page: PageFrame, fromX: number) {
  return { left: page.x - fromX, width: page.width };
}
